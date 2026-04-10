import { DataSource } from 'typeorm';
import { TransactionManager } from './transaction-manager.service';
import { OutboxRepository } from '../repositories/outbox.repository';
import { EventPublisher } from '../messaging/event-publisher.service';
import { OutboxEvent } from '../../domain/entities/outbox-event.entity';
import { WalletEventType } from '../../modules/wallet/entities/wallet-event.entity';

describe('TransactionManager', () => {
  let service: TransactionManager;
  let queryRunner: {
    connect: jest.Mock;
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
    manager: Record<string, never>;
  };
  let dataSource: Pick<DataSource, 'createQueryRunner'>;
  let outboxRepository: Pick<OutboxRepository, 'saveAll'>;
  let eventPublisher: Pick<EventPublisher, 'publish'>;
  let redis: {
    set: jest.Mock;
    del: jest.Mock;
  };

  beforeEach(() => {
    queryRunner = {
      connect: jest.fn(async () => undefined),
      startTransaction: jest.fn(async () => undefined),
      commitTransaction: jest.fn(async () => undefined),
      rollbackTransaction: jest.fn(async () => undefined),
      release: jest.fn(async () => undefined),
      manager: {},
    };

    dataSource = {
      createQueryRunner: jest.fn(() => queryRunner as never),
    };

    outboxRepository = {
      saveAll: jest.fn(async (events: OutboxEvent[]) => events),
    };

    eventPublisher = {
      publish: jest.fn(async () => undefined),
    };

    redis = {
      set: jest.fn(async () => 'OK'),
      del: jest.fn(async () => 1),
    };

    service = new (TransactionManager as any)(
      dataSource,
      outboxRepository,
      eventPublisher,
      redis,
    );
  });

  it('persists queued outbox events but leaves broker delivery to the relay', async () => {
    const event = new OutboxEvent('wallet-1', WalletEventType.FUNDS_DEPOSITED, {
      eventType: WalletEventType.FUNDS_DEPOSITED,
      walletId: 'wallet-1',
      amount: 100,
    });

    const result = await service.execute(async (ctx) => {
      ctx.publishEvent(event);
      return { ok: true };
    });

    await flushAsyncWork();

    expect(result).toEqual({ ok: true });
    expect(outboxRepository.saveAll).toHaveBeenCalledWith([event], queryRunner.manager);
    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });
});

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}
