import { Test, TestingModule } from '@nestjs/testing';
import { FraudDetectionConsumer } from '../../modules/fraud/consumers/fraud-detection.consumer';
import { AppConfigService } from '../../config/app-config.service';
import { DataSource } from 'typeorm';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module';
import { WalletEventType } from '../../modules/wallet/entities/wallet-event.entity';
import { FRAUD_CONSTANTS } from './fraud-detection.constants';
import { AmqpMessage, WalletEventPayload } from './amqp.interfaces';
import { RABBITMQ_CONNECTION } from '../../infrastructure/messaging/rabbitmq.module';

describe('FraudDetectionConsumer', () => {
  let consumer: FraudDetectionConsumer;
  let redisMock: any;
  let configServiceMock: any;
  let dataSourceMock: any;
  let fraudAlertRepoMock: any;
  let channelMock: any;

  beforeEach(async () => {
    redisMock = {
      set: jest.fn(),
      zadd: jest.fn(),
      zremrangebyscore: jest.fn(),
      expire: jest.fn(),
      zcard: jest.fn(),
      disconnect: jest.fn(),
    };

    configServiceMock = {
      rabbitMqUrl: 'amqp://localhost',
      rabbitMqExchange: 'wallet_exchange',
      fraudDetectionQueue: 'fraud_queue',
      fraudDetectionTimeWindowMinutes: 60,
      fraudDetectionMaxWithdrawals: 5,
      fraudDetectionThreshold: 10000,
    };

    fraudAlertRepoMock = {
      save: jest.fn(),
    };

    dataSourceMock = {
      getRepository: jest.fn().mockReturnValue(fraudAlertRepoMock),
    };

    channelMock = {
      assertExchange: jest.fn(),
      assertQueue: jest.fn(),
      bindQueue: jest.fn(),
      prefetch: jest.fn(),
      consume: jest.fn(),
      ack: jest.fn(),
      nack: jest.fn(),
      sendToQueue: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FraudDetectionConsumer,
        { provide: AppConfigService, useValue: configServiceMock },
        { provide: DataSource, useValue: dataSourceMock },
        { provide: REDIS_CLIENT, useValue: redisMock },
        { provide: RABBITMQ_CONNECTION, useValue: { createChannel: jest.fn() } },
      ],
    }).compile();

    consumer = module.get<FraudDetectionConsumer>(FraudDetectionConsumer);
  });

  it('should be defined', () => {
    expect(consumer).toBeDefined();
  });

  describe('setupTopology', () => {
    it('should declare route-specific wait queues with TTL and dead-letter routing keys', async () => {
      await consumer['setupTopology'](channelMock);

      for (const delay of FRAUD_CONSTANTS.RETRY.DELAYS) {
        for (const routingKey of [
          FRAUD_CONSTANTS.ROUTING_KEYS.FUNDS_WITHDRAWN,
          FRAUD_CONSTANTS.ROUTING_KEYS.TRANSFER_COMPLETED,
        ]) {
          expect(channelMock.assertQueue).toHaveBeenCalledWith(
            `fraud_queue.wait.${delay}.${routingKey}`,
            expect.objectContaining({
              durable: true,
              arguments: expect.objectContaining({
                [FRAUD_CONSTANTS.HEADERS.DEAD_LETTER_EXCHANGE]: 'wallet_exchange',
                'x-dead-letter-routing-key': routingKey,
                [FRAUD_CONSTANTS.HEADERS.MESSAGE_TTL]: delay,
              }),
            })
          );
        }
      }
    });
  });

  describe('handleMessage', () => {
    const baseEvent: WalletEventPayload = {
      walletId: 'wallet-123',
      eventType: WalletEventType.FUNDS_WITHDRAWN,
      amount: 500,
      timestamp: new Date().toISOString(),
    };

    const createMockMsg = (options: {
      eventOverrides?: Partial<WalletEventPayload>;
      routingKey?: string;
      headers?: Record<string, unknown>;
    } = {}): AmqpMessage => {
      const eventOverrides = options.eventOverrides ?? {};
      const headers = options.headers ?? {};
      const routingKey = Object.prototype.hasOwnProperty.call(options, 'routingKey')
        ? options.routingKey
        : FRAUD_CONSTANTS.ROUTING_KEYS.FUNDS_WITHDRAWN;

      return {
        content: Buffer.from(JSON.stringify({ ...baseEvent, ...eventOverrides })),
        properties: { headers },
        fields: {
          deliveryTag: 1,
          redelivered: false,
          exchange: 'wallet_exchange',
          routingKey,
        } as AmqpMessage['fields'],
      };
    };

    it('should nack malformed JSON immediately', async () => {
      const mockMsg = createMockMsg();
      const malformedMsg = { ...mockMsg, content: Buffer.from('invalid-json') };
      await consumer['handleMessage'](malformedMsg, channelMock);
      expect(channelMock.nack).toHaveBeenCalledWith(malformedMsg, false, false);
    });

    it('should ack duplicate events (idempotency)', async () => {
      const mockMsg = createMockMsg();
      redisMock.set.mockResolvedValue(null); // Key exists (not new)
      await consumer['handleMessage'](mockMsg, channelMock);
      expect(channelMock.ack).toHaveBeenCalledWith(mockMsg);
      expect(redisMock.set).toHaveBeenCalled();
      expect(fraudAlertRepoMock.save).not.toHaveBeenCalled();
    });

    it('should process new events and ack', async () => {
      const mockMsg = createMockMsg();
      redisMock.set.mockResolvedValue('OK'); // New key
      await consumer['handleMessage'](mockMsg, channelMock);
      expect(channelMock.ack).toHaveBeenCalledWith(mockMsg);
      expect(redisMock.set).toHaveBeenCalled();
    });

    it('should detect high value transactions', async () => {
      redisMock.set.mockResolvedValue('OK');
      const highValueMsg = createMockMsg({
        eventOverrides: { amount: 20000 },
      });

      await consumer['handleMessage'](highValueMsg, channelMock);

      expect(fraudAlertRepoMock.save).toHaveBeenCalledWith(
        expect.objectContaining({
          alertType: FRAUD_CONSTANTS.ALERTS.HIGH_VALUE_TRANSACTION,
          details: expect.objectContaining({ amount: 20000 }),
        })
      );
    });

    it('should detect rapid withdrawals', async () => {
      const mockMsg = createMockMsg();
      redisMock.set.mockResolvedValue('OK');
      redisMock.zcard.mockResolvedValue(10); // > 5 max withdrawals

      await consumer['handleMessage'](mockMsg, channelMock);

      expect(fraudAlertRepoMock.save).toHaveBeenCalledWith(
        expect.objectContaining({
          alertType: FRAUD_CONSTANTS.ALERTS.RAPID_WITHDRAWALS,
          details: expect.objectContaining({ withdrawalCount: 10 }),
        })
      );
    });

    it('should retry withdrawal events via the route-specific wait queue', async () => {
      const mockMsg = createMockMsg();
      redisMock.set.mockResolvedValue('OK');
      jest.spyOn(consumer as any, 'processFraudChecks').mockRejectedValue(new Error('Processing failed'));

      await consumer['handleMessage'](mockMsg, channelMock);

      expect(channelMock.sendToQueue).toHaveBeenCalledWith(
        'fraud_queue.wait.1000.wallet.funds_withdrawn',
        expect.any(Buffer),
        expect.objectContaining({
          headers: expect.objectContaining({ [FRAUD_CONSTANTS.HEADERS.RETRY_COUNT]: 1 }),
        })
      );
      expect(channelMock.sendToQueue.mock.calls[0][2].type).toBeUndefined();
      expect(channelMock.ack).toHaveBeenCalledWith(mockMsg);
    });

    it('should retry transfer completion events via the route-specific wait queue', async () => {
      const transferCompletedMsg = createMockMsg({
        eventOverrides: { eventType: WalletEventType.TRANSFER_COMPLETED },
        routingKey: FRAUD_CONSTANTS.ROUTING_KEYS.TRANSFER_COMPLETED,
      });
      redisMock.set.mockResolvedValue('OK');
      jest.spyOn(consumer as any, 'processFraudChecks').mockRejectedValue(new Error('Processing failed'));

      await consumer['handleMessage'](transferCompletedMsg, channelMock);

      expect(channelMock.sendToQueue).toHaveBeenCalledWith(
        'fraud_queue.wait.1000.wallet.transfer_completed',
        expect.any(Buffer),
        expect.objectContaining({
          headers: expect.objectContaining({ [FRAUD_CONSTANTS.HEADERS.RETRY_COUNT]: 1 }),
        })
      );
      expect(channelMock.ack).toHaveBeenCalledWith(transferCompletedMsg);
    });

    it.each([
      'wallet.unsupported',
      undefined,
    ])('should DLQ instead of retrying when the routing key is %p', async (routingKey) => {
      const invalidRoutingKeyMsg = createMockMsg({ routingKey });
      redisMock.set.mockResolvedValue('OK');
      jest.spyOn(consumer as any, 'processFraudChecks').mockRejectedValue(new Error('Processing failed'));

      await consumer['handleMessage'](invalidRoutingKeyMsg, channelMock);

      expect(channelMock.sendToQueue).not.toHaveBeenCalled();
      expect(channelMock.ack).not.toHaveBeenCalled();
      expect(channelMock.nack).toHaveBeenCalledWith(invalidRoutingKeyMsg, false, false);
    });

    it('should DLQ after max retries', async () => {
      const retryMsg = createMockMsg({
        headers: { [FRAUD_CONSTANTS.HEADERS.RETRY_COUNT]: 3 },
      });
      redisMock.set.mockResolvedValue('OK');
      jest.spyOn(consumer as any, 'processFraudChecks').mockRejectedValue(new Error('Processing failed'));

      await consumer['handleMessage'](retryMsg, channelMock);

      expect(channelMock.nack).toHaveBeenCalledWith(retryMsg, false, false);
    });
  });
});
