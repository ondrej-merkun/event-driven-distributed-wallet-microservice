import { Wallet } from '../../wallet/entities/wallet.entity';
import { TransferSaga, TransferSagaState } from '../entities/transfer-saga.entity';
import { TransferSagaService } from './transfer-saga.service';
import { WalletRepository } from '../../wallet/repositories/wallet.repository';
import { TransferSagaRepository } from '../repositories/transfer-saga.repository';
import { IdempotencyRepository } from '../../../infrastructure/repositories/idempotency.repository';
import { EventPublisher, WalletEventMessage } from '../../../infrastructure/messaging/event-publisher.service';
import { AppConfigService } from '../../../config/app-config.service';
import {
  TransactionContext,
  TransactionManager,
} from '../../../infrastructure/database/transaction-manager.service';
import { WalletEventType } from '../../wallet/entities/wallet-event.entity';
import { OutboxEvent } from '../../../domain/entities/outbox-event.entity';

describe('TransferSagaService regression', () => {
  let service: TransferSagaService;
  let senderWallet: Wallet;
  let receiverWallet: Wallet;
  let persistedSaga: TransferSaga | null;
  let nextSagaId: number;
  let publishFailures: Set<WalletEventType>;
  let walletService: { invalidateBalanceCache: jest.Mock };
  let walletRepository: Pick<WalletRepository, 'findById' | 'getOrCreate'>;
  let sagaRepository: Pick<TransferSagaRepository, 'save' | 'findById'>;
  let idempotencyRepository: Pick<IdempotencyRepository, 'findByRequestId' | 'save'>;
  let eventPublisher: Pick<EventPublisher, 'publish'>;
  let configService: Pick<AppConfigService, 'maxRetries' | 'initialBackoffMs'>;
  let transactionManager: Pick<TransactionManager, 'execute'>;

  beforeEach(() => {
    senderWallet = new Wallet('sender-wallet', 'USD');
    senderWallet.balance = 100;

    receiverWallet = new Wallet('receiver-wallet', 'USD');
    receiverWallet.balance = 0;

    persistedSaga = null;
    nextSagaId = 1;
    publishFailures = new Set<WalletEventType>();

    walletService = {
      invalidateBalanceCache: jest.fn(async () => undefined),
    };

    walletRepository = {
      findById: jest.fn(async (walletId: string) => {
        if (walletId === senderWallet.id) {
          return senderWallet;
        }

        if (walletId === receiverWallet.id) {
          return receiverWallet;
        }

        return null;
      }),
      getOrCreate: jest.fn(async () => receiverWallet),
    };

    sagaRepository = {
      save: jest.fn(async (saga: TransferSaga) => {
        if (!saga.id) {
          saga.id = `saga-${nextSagaId++}`;
        }

        persistedSaga = cloneSaga(saga);
        return persistedSaga;
      }),
      findById: jest.fn(async (sagaId: string) => {
        if (persistedSaga?.id === sagaId) {
          return cloneSaga(persistedSaga);
        }

        return null;
      }),
    };

    idempotencyRepository = {
      findByRequestId: jest.fn(async () => null),
      save: jest.fn(async (key) => key),
    };

    eventPublisher = {
      publish: jest.fn(async (event: WalletEventMessage) => {
        if (publishFailures.has(event.eventType)) {
          publishFailures.delete(event.eventType);
          throw new Error(`${event.eventType} publish failed`);
        }
      }),
    };

    configService = {
      maxRetries: 1,
      initialBackoffMs: 1,
    };

    transactionManager = {
      execute: jest.fn(async <T>(
        operation: (context: TransactionContext) => Promise<T>,
      ): Promise<T> => {
        const transactionSender = cloneWallet(senderWallet);
        const transactionReceiver = cloneWallet(receiverWallet);
        let transactionSaga = persistedSaga ? cloneSaga(persistedSaga) : null;
        const queuedEvents: OutboxEvent[] = [];

        const manager = {
          findOne: jest.fn(async (
            entity: unknown,
            options: { where: { id: string } },
          ) => {
            const entityId = options.where.id;

            if (entity === Wallet) {
              if (entityId === transactionSender.id) {
                return transactionSender;
              }

              if (entityId === transactionReceiver.id) {
                return transactionReceiver;
              }
            }

            if (entity === TransferSaga && transactionSaga?.id === entityId) {
              return transactionSaga;
            }

            return null;
          }),
          save: jest.fn(async (value: unknown) => {
            if (value instanceof TransferSaga) {
              if (!value.id) {
                value.id = `saga-${nextSagaId++}`;
              }

              transactionSaga = value;
            }

            return value;
          }),
        } as unknown as TransactionContext['manager'];

        const result = await operation({
          manager,
          publishEvent: (event) => {
            queuedEvents.push(event);
          },
        });

        syncWallet(senderWallet, transactionSender);
        syncWallet(receiverWallet, transactionReceiver);
        persistedSaga = transactionSaga ? cloneSaga(transactionSaga) : null;

        for (const event of queuedEvents) {
          try {
            await eventPublisher.publish(event.payload);
          } catch {
            // Match TransactionManager best-effort publish semantics.
          }
        }

        return result;
      }),
    };

    service = new TransferSagaService(
      walletService as never,
      walletRepository as WalletRepository,
      sagaRepository as TransferSagaRepository,
      idempotencyRepository as IdempotencyRepository,
      eventPublisher as EventPublisher,
      configService as AppConfigService,
      transactionManager as TransactionManager,
    );
  });

  it('completes the transfer when the initiated publish fails after the saga transaction commits', async () => {
    publishFailures.add(WalletEventType.TRANSFER_INITIATED);

    const result = await service.executeTransfer(senderWallet.id, receiverWallet.id, 25);

    expect(result).toMatchObject({
      sagaId: 'saga-1',
      state: TransferSagaState.COMPLETED,
      fromWalletId: senderWallet.id,
      toWalletId: receiverWallet.id,
      amount: 25,
    });
    expect(senderWallet.balance).toBe(75);
    expect(receiverWallet.balance).toBe(25);
    expect(persistedSaga?.state).toBe(TransferSagaState.COMPLETED);
    expect(eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: WalletEventType.TRANSFER_INITIATED }),
    );
  });

  it('preserves COMPLETED when the completion publish fails after funds move', async () => {
    publishFailures.add(WalletEventType.TRANSFER_COMPLETED);

    const result = await service.executeTransfer(senderWallet.id, receiverWallet.id, 25);

    expect(result.state).toBe(TransferSagaState.COMPLETED);
    expect(senderWallet.balance).toBe(75);
    expect(receiverWallet.balance).toBe(25);
    expect(persistedSaga?.state).toBe(TransferSagaState.COMPLETED);
    expect(eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: WalletEventType.TRANSFER_COMPLETED }),
    );
  });
});

function cloneWallet(wallet: Wallet): Wallet {
  const clone = new Wallet(wallet.id, wallet.currency);
  clone.balance = wallet.balance;
  clone.status = wallet.status;
  clone.dailyWithdrawalLimit = wallet.dailyWithdrawalLimit;
  clone.dailyWithdrawalTotal = wallet.dailyWithdrawalTotal;
  clone.lastWithdrawalDate = wallet.lastWithdrawalDate;
  clone.version = wallet.version;
  clone.createdAt = wallet.createdAt;
  clone.updatedAt = wallet.updatedAt;
  return clone;
}

function syncWallet(target: Wallet, source: Wallet): void {
  target.balance = source.balance;
  target.status = source.status;
  target.dailyWithdrawalLimit = source.dailyWithdrawalLimit;
  target.dailyWithdrawalTotal = source.dailyWithdrawalTotal;
  target.lastWithdrawalDate = source.lastWithdrawalDate;
  target.version = source.version;
  target.createdAt = source.createdAt;
  target.updatedAt = source.updatedAt;
}

function cloneSaga(saga: TransferSaga): TransferSaga {
  const clone = new TransferSaga(
    saga.fromWalletId,
    saga.toWalletId,
    Number(saga.amount),
    saga.currency,
  );
  clone.id = saga.id;
  clone.state = saga.state;
  clone.metadata = saga.metadata ? { ...saga.metadata } : null;
  clone.createdAt = saga.createdAt;
  clone.updatedAt = saga.updatedAt;
  return clone;
}
