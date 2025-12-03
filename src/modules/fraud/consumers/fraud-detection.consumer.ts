import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import * as amqp from 'amqp-connection-manager';
import { ChannelWrapper } from 'amqp-connection-manager';
import { DataSource, Repository } from 'typeorm';
import { Redis } from 'ioredis';
import { WalletEventType } from '../../wallet/entities/wallet-event.entity';
import { AppConfigService } from '../../../config/app-config.service';
import { FraudAlert } from '../entities/fraud-alert.entity';
import { AmqpMessage, WalletEventPayload, AmqpChannel } from '../../../workers/consumers/amqp.interfaces';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.module';
import { FRAUD_CONSTANTS } from '../../../workers/consumers/fraud-detection.constants';
import * as crypto from 'crypto';
import { RABBITMQ_CONNECTION } from '../../../infrastructure/messaging/rabbitmq.module';

@Injectable()
export class FraudDetectionConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FraudDetectionConsumer.name);
  private channelWrapper: ChannelWrapper | null = null;
  private fraudAlertRepository: Repository<FraudAlert>;

  constructor(
    private configService: AppConfigService,
    private dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(RABBITMQ_CONNECTION) private readonly connection: amqp.AmqpConnectionManager,
  ) {
    this.fraudAlertRepository = this.dataSource.getRepository(FraudAlert);
  }

  async onModuleInit() {
    // Start connection asynchronously without blocking module initialization
    this.connect().catch(err => {
      this.logger.error('Failed to connect FraudDetectionConsumer', err);
    });
  }

  private async connect(): Promise<void> {
    this.channelWrapper = this.connection.createChannel({
      json: true,
      setup: async (channel: AmqpChannel) => {
        await this.setupTopology(channel);
      },
    });
  }

  private async setupTopology(channel: AmqpChannel): Promise<void> {
    const exchange = this.configService.rabbitMqExchange;
    const queueName = this.configService.fraudDetectionQueue;
    const dlxExchange = `${exchange}${FRAUD_CONSTANTS.AMQP.DLX_SUFFIX}`;
    const dlqQueue = `${queueName}${FRAUD_CONSTANTS.AMQP.DLQ_SUFFIX}`;

    // 1. Assert Dead Letter Exchange (DLX)
    await channel.assertExchange(dlxExchange, FRAUD_CONSTANTS.AMQP.EXCHANGE_TYPE, { durable: true });

    // 2. Assert Dead Letter Queue (DLQ)
    await channel.assertQueue(dlqQueue, { durable: true });

    // 3. Bind DLQ to DLX
    await channel.bindQueue(dlqQueue, dlxExchange, FRAUD_CONSTANTS.AMQP.DLQ_BINDING_KEY);

    // 4. Assert Main Exchange
    await channel.assertExchange(exchange, FRAUD_CONSTANTS.AMQP.EXCHANGE_TYPE, { durable: true });

    // 5. Assert Main Queue with DLX configuration
    await channel.assertQueue(queueName, {
      durable: true,
      arguments: {
        [FRAUD_CONSTANTS.HEADERS.DEAD_LETTER_EXCHANGE]: dlxExchange,
      },
    });

    // 6. Assert Wait Queues for Non-Blocking Retries
    for (const delay of FRAUD_CONSTANTS.RETRY.DELAYS) {
      const waitQueue = `${queueName}${FRAUD_CONSTANTS.AMQP.WAIT_QUEUE_SUFFIX}${delay}`;
      await channel.assertQueue(waitQueue, {
        durable: true,
        arguments: {
          [FRAUD_CONSTANTS.HEADERS.DEAD_LETTER_EXCHANGE]: exchange, // Route back to main exchange after TTL
          [FRAUD_CONSTANTS.HEADERS.MESSAGE_TTL]: delay,
        },
      });
    }
    
    // Bind to withdrawal and transfer events
    await channel.bindQueue(queueName, exchange, FRAUD_CONSTANTS.ROUTING_KEYS.FUNDS_WITHDRAWN);
    await channel.bindQueue(queueName, exchange, FRAUD_CONSTANTS.ROUTING_KEYS.TRANSFER_COMPLETED);
    
    // Only fetch 1 message at a time for efficient load-balancing
    await channel.prefetch(1);

    this.logger.log(`Queue ${queueName} bound to exchange ${exchange} with DLX ${dlxExchange}`);

    await channel.consume(
      queueName,
      async (msg: AmqpMessage | null) => {
        if (msg) {
          await this.handleMessage(msg, channel);
        }
      },
      { noAck: false }
    );
  }

  private async handleMessage(msg: AmqpMessage, channel: AmqpChannel): Promise<void> {
    let event: WalletEventPayload;
    try {
      event = JSON.parse(msg.content.toString());
    } catch (e) {
      this.logger.error('Failed to parse message content', e);
      channel.nack(msg, false, false); // Send to DLQ immediately, if parsing failed, it will fail next time again
      return;
    }

    try {
      // Generate a robust idempotency key
      const eventId = this.generateIdempotencyKey(event);

      // Atomic Idempotency Check (SETNX)
      const isNew = await this.acquireLock(eventId);

      if (!isNew) {
        this.logger.debug(`Event already processed (atomic check): ${eventId}`);
        channel.ack(msg);
        return;
      }

      this.logger.debug(`Processing event: ${event.eventType} for wallet ${event.walletId}`);

      // Business Logic
      await this.processFraudChecks(event);

      // Acknowledge message
      channel.ack(msg);
    } catch (error: unknown) {
      await this.handleProcessingError(msg, channel, error as Error);
    }
  }

  private generateIdempotencyKey(event: WalletEventPayload): string {
    // If event has a unique ID, use it. Otherwise hash the content.
    // Assuming event might not have a unique ID property, we hash the critical fields
    const payload = `${event.walletId}-${event.eventType}-${event.timestamp}-${event.amount || ''}`;
    return crypto.createHash(FRAUD_CONSTANTS.CRYPTO.ALGORITHM).update(payload).digest(FRAUD_CONSTANTS.CRYPTO.ENCODING as crypto.BinaryToTextEncoding);
  }

  private async acquireLock(eventId: string): Promise<boolean> {
    const key = `${FRAUD_CONSTANTS.REDIS_KEYS.PROCESSED_EVENT_PREFIX}${eventId}`;
    const result = await this.redis.set(
      key,
      'true',
      'EX',
      FRAUD_CONSTANTS.IDEMPOTENCY_TTL,
      'NX'
    );
    return result === 'OK';
  }

  private async processFraudChecks(event: WalletEventPayload): Promise<void> {
    if (event.eventType === WalletEventType.FUNDS_WITHDRAWN) {
      await this.detectRapidWithdrawals(event);
      await this.detectHighValueTransaction(event);
    }
  }

  private async handleProcessingError(msg: AmqpMessage, channel: AmqpChannel, error: Error): Promise<void> {
    this.logger.error(`Error processing message: ${error.message}`, error.stack);

    const retryCount = (msg.properties.headers?.[FRAUD_CONSTANTS.HEADERS.RETRY_COUNT] || 0);
    
    if (retryCount < FRAUD_CONSTANTS.RETRY.MAX_ATTEMPTS) {
      const delay = FRAUD_CONSTANTS.RETRY.DELAYS[retryCount] || FRAUD_CONSTANTS.RETRY.DELAYS[FRAUD_CONSTANTS.RETRY.DELAYS.length - 1];
      const waitQueue = `${this.configService.fraudDetectionQueue}${FRAUD_CONSTANTS.AMQP.WAIT_QUEUE_SUFFIX}${delay}`;
      
      this.logger.warn(`Retrying message (attempt ${retryCount + 1}/${FRAUD_CONSTANTS.RETRY.MAX_ATTEMPTS}) via ${waitQueue}`);
      
      channel.sendToQueue(
        waitQueue,
        msg.content,
        {
          headers: { ...msg.properties.headers, [FRAUD_CONSTANTS.HEADERS.RETRY_COUNT]: retryCount + 1 },
          persistent: true,
          type: msg.fields.routingKey, 
        }
      );
      
      channel.ack(msg);
    } else {
      this.logger.error(`Message failed after ${FRAUD_CONSTANTS.RETRY.MAX_ATTEMPTS} retries, sending to DLQ`);
      channel.nack(msg, false, false);
    }
  }

  private async detectRapidWithdrawals(event: WalletEventPayload): Promise<void> {
    const walletId = event.walletId;
    const now = new Date(event.timestamp).getTime();
    const key = `${FRAUD_CONSTANTS.REDIS_KEYS.WITHDRAWALS_PREFIX}${walletId}`;
    const timeWindowMinutes = this.configService.fraudDetectionTimeWindowMinutes;
    const windowMs = timeWindowMinutes * 60 * 1000;

    await this.redis.zadd(key, now, now.toString());

    const cutoff = now - windowMs;
    await this.redis.zremrangebyscore(key, FRAUD_CONSTANTS.REDIS.SCORE_MIN, cutoff);

    await this.redis.expire(key, timeWindowMinutes * 60);

    const count = await this.redis.zcard(key);

    const maxWithdrawals = this.configService.fraudDetectionMaxWithdrawals;
    if (count > maxWithdrawals) {
      this.logger.warn(`FRAUD ALERT: Wallet ${walletId} has ${count} withdrawals in the last ${timeWindowMinutes} minutes`);
      await this.saveFraudAlert(walletId, FRAUD_CONSTANTS.ALERTS.RAPID_WITHDRAWALS, {
        withdrawalCount: count,
        timeWindow: `${timeWindowMinutes} minutes`,
      });
    }
  }

  private async detectHighValueTransaction(event: WalletEventPayload): Promise<void> {
    const threshold = this.configService.fraudDetectionThreshold;
    
    if (event.amount && event.amount > threshold) {
      this.logger.warn(`FRAUD ALERT: High-value withdrawal of $${event.amount} from wallet ${event.walletId}`);
      await this.saveFraudAlert(event.walletId, FRAUD_CONSTANTS.ALERTS.HIGH_VALUE_TRANSACTION, {
        amount: event.amount,
        threshold,
      });
    }
  }

  private async saveFraudAlert(walletId: string, alertType: string, details: Record<string, unknown>): Promise<void> {
    try {
      const alert = new FraudAlert(walletId, alertType, details);
      await this.fraudAlertRepository.save(alert);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Could not save fraud alert: ${errorMessage}`);
    }
  }

  async onModuleDestroy() {
    if (this.channelWrapper) {
      await this.channelWrapper.close();
    }
    // Connection is managed by RabbitMQModule
  }
}
