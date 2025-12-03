import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { WalletService } from '../../wallet/services/wallet.service';

import { WalletRepository } from '../../wallet/repositories/wallet.repository';
import { TransferSagaRepository } from '../repositories/transfer-saga.repository';
import { IdempotencyRepository } from '../../../infrastructure/repositories/idempotency.repository';
import { EventPublisher } from '../../../infrastructure/messaging/event-publisher.service';
import { TransferSaga, TransferSagaState } from '../entities/transfer-saga.entity';
import { WalletEventType, WalletEvent } from '../../wallet/entities/wallet-event.entity';
import { IdempotencyKey } from '../../../domain/entities/idempotency-key.entity';
import { Wallet } from '../../wallet/entities/wallet.entity';
import { CurrencyMismatchError } from '../../../domain/exceptions/transfer.exceptions';
import { AppConfigService } from '../../../config/app-config.service';
import { OutboxEvent } from '../../../domain/entities/outbox-event.entity';
import { TransactionManager } from '../../../infrastructure/database/transaction-manager.service';


export interface TransferResult {
  sagaId: string;
  state: TransferSagaState;
  fromWalletId: string;
  toWalletId: string;
  amount: number;
}

@Injectable()
export class TransferSagaService {
  private readonly logger = new Logger(TransferSagaService.name);

  constructor(
    private walletService: WalletService,
    private walletRepository: WalletRepository,
    private sagaRepository: TransferSagaRepository,
    private idempotencyRepository: IdempotencyRepository,
    private eventPublisher: EventPublisher,
    private configService: AppConfigService,
    private transactionManager: TransactionManager,
  ) {}

  async executeTransfer(
    fromWalletId: string,
    toWalletId: string,
    amount: number,
    requestId?: string,
  ): Promise<TransferResult> {
    // Check idempotency
    if (requestId) {
      const existing = await this.idempotencyRepository.findByRequestId(requestId);
      if (existing) {
        this.logger.log(`Duplicate transfer request detected: ${requestId}`);
        return existing.response as any;
      }
    }

    if (fromWalletId === toWalletId) {
      throw new Error('Cannot transfer to the same wallet');
    }

    // Validate currency compatibility
    // Note: Cross-currency transfers are not supported in this implementation.
    const fromWallet = await this.walletRepository.findById(fromWalletId);
    if (!fromWallet) {
      throw new NotFoundException(`Wallet ${fromWalletId} not found`);
    }
    const toWallet = await this.walletRepository.getOrCreate(toWalletId, fromWallet.currency);
    if (toWallet.currency !== fromWallet.currency) {
      throw new CurrencyMismatchError(
        fromWallet.currency,
        toWallet.currency,
        fromWalletId,
        toWalletId,
      );
    }

    // Create saga with currency from sender wallet
    const saga = new TransferSaga(fromWalletId, toWalletId, amount, fromWallet.currency);
    await this.sagaRepository.save(saga);

    this.logger.log(`Transfer saga created: ${saga.id}`);

    // Publish transfer initiated event
    await this.eventPublisher.publish(
      {
        eventType: WalletEventType.TRANSFER_INITIATED,
        walletId: fromWalletId,
        amount,
        metadata: { sagaId: saga.id, toWalletId, requestId },
        timestamp: new Date(),
      },
    );

    try {
      await this.debitFromSender(saga);
      // Reload saga to get updated state
      const updatedSaga = await this.sagaRepository.findById(saga.id);
      if (!updatedSaga) {
        throw new Error(`Saga ${saga.id} not found after debit`);
      }

      await this.creditToReceiver(updatedSaga);
      // Reload again to get final state
      const finalSaga = await this.sagaRepository.findById(saga.id);
      if (!finalSaga) {
        throw new Error(`Saga ${saga.id} not found after credit`);
      }

      finalSaga.markAsCompleted();
      await this.sagaRepository.save(finalSaga);

      this.logger.log(`Transfer saga completed: ${finalSaga.id}`);

      // Publish transfer completed event
      await this.eventPublisher.publish(
        {
          eventType: WalletEventType.TRANSFER_COMPLETED,
          walletId: fromWalletId,
          amount,
          metadata: { sagaId: saga.id, toWalletId },
          timestamp: new Date(),
        },
      );

      const result = {
        sagaId: finalSaga.id,
        state: finalSaga.state,
        fromWalletId: finalSaga.fromWalletId,
        toWalletId: finalSaga.toWalletId,
        amount: Number(finalSaga.amount),
      };

      // Store idempotency key
      if (requestId) {
        await this.idempotencyRepository.save(new IdempotencyKey(requestId, result));
      }

      return result;
    } catch (error: any) {
      this.logger.error(`Transfer saga failed: ${saga.id}`, error.message);

      // Reload saga to check its actual state
      const currentSaga = await this.sagaRepository.findById(saga.id);
      if (!currentSaga) {
        throw new Error(`Saga ${saga.id} not found during error handling`);
      }

      // Compensate if debit succeeded but credit failed
      if (currentSaga.state === TransferSagaState.DEBITED) {
        await this.compensate(currentSaga.id, currentSaga.fromWalletId, Number(currentSaga.amount), error.message);
      } else {
        currentSaga.markAsFailed(error.message);
        await this.sagaRepository.save(currentSaga);
      }

      throw error;
    }
  }

  private async debitFromSender(saga: TransferSaga): Promise<void> {
    await this.executeTransactionalStep({
      sagaId: saga.id,
      walletId: saga.fromWalletId,
      amount: saga.amount,
      operation: (wallet) => wallet.withdraw(Number(saga.amount)),
      eventType: WalletEventType.FUNDS_WITHDRAWN,
      eventMetadata: { sagaId: saga.id, transferTo: saga.toWalletId },
      logMessage: `Debited ${saga.amount} from wallet ${saga.fromWalletId}`,
      updateSaga: (s) => s.markAsDebited(),
    });
    
    // Invalidate cache for sender wallet
    await this.walletService.invalidateBalanceCache(saga.fromWalletId);
  }

  private async creditToReceiver(saga: TransferSaga): Promise<void> {
    await this.executeTransactionalStep({
      sagaId: saga.id,
      walletId: saga.toWalletId,
      amount: saga.amount,
      operation: (wallet) => wallet.credit(Number(saga.amount)),
      eventType: WalletEventType.FUNDS_DEPOSITED,
      eventMetadata: { sagaId: saga.id, transferFrom: saga.fromWalletId },
      logMessage: `Credited ${saga.amount} to wallet ${saga.toWalletId}`,
    });
    
    // Invalidate cache for receiver wallet
    await this.walletService.invalidateBalanceCache(saga.toWalletId);
  }

  private async compensate(sagaId: string, fromWalletId: string, amount: number, errorMessage: string): Promise<void> {
    this.logger.warn(`Compensating transfer saga: ${sagaId}`);

    try {
      await this.executeTransactionalStep({
        sagaId,
        walletId: fromWalletId,
        amount,
        operation: (wallet) => wallet.credit(Number(amount)),
        eventType: WalletEventType.TRANSFER_COMPENSATED,
        eventMetadata: { sagaId, reason: errorMessage },
        logMessage: `Transfer saga compensated: ${sagaId}`,
        updateSaga: (s) => s.markAsCompensated(errorMessage),
      });

      // Publish compensation event
      await this.eventPublisher.publish({
        eventType: WalletEventType.TRANSFER_FAILED,
        walletId: fromWalletId,
        amount: Number(amount),
        metadata: { sagaId, reason: errorMessage },
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.error(`Compensation failed for saga: ${sagaId}`, error);
      throw error;
    }
  }

  async recoverSaga(sagaId: string): Promise<void> {
    const saga = await this.sagaRepository.findById(sagaId);
    if (!saga) {
      this.logger.warn(`Cannot recover saga ${sagaId}: Not found`);
      return;
    }

    if (saga.state === TransferSagaState.DEBITED) {
      this.logger.log(`Resuming saga ${sagaId} from DEBITED state`);
      try {
        await this.creditToReceiver(saga);
        
        saga.markAsCompleted();
        await this.sagaRepository.save(saga);
        
        this.logger.log(`Saga ${sagaId} recovery completed successfully`);

        // Publish completion event
        await this.eventPublisher.publish({
          eventType: WalletEventType.TRANSFER_COMPLETED,
          walletId: saga.fromWalletId,
          amount: Number(saga.amount),
          metadata: { sagaId: saga.id, toWalletId: saga.toWalletId, recovered: true },
          timestamp: new Date(),
        });
      } catch (error: any) {
        this.logger.error(`Recovery failed for saga ${sagaId}: ${error.message}`);
        // If recovery fails (e.g., receiver wallet closed), we should compensate
        await this.compensate(saga.id, saga.fromWalletId, Number(saga.amount), `Recovery failed: ${error.message}`);
      }
    }
  }

  /* Atomic operation - either we successfully complete operation
  ** AND save the event, or neither happens.
  */
  private async executeTransactionalStep(params: {
    sagaId: string;
    walletId: string;
    amount: number | string;
    operation: (wallet: Wallet) => void;
    eventType: WalletEventType;
    eventMetadata: Record<string, any>;
    logMessage: string;
    updateSaga?: (saga: TransferSaga) => void;
  }): Promise<void> {
    const { sagaId, walletId, amount, operation, eventType, eventMetadata, logMessage, updateSaga } = params;

    await this.executeWithRetry(async () => {
      await this.transactionManager.execute(async (ctx) => {
        // Load wallet with pessimistic lock
        const wallet = await ctx.manager.findOne(
          Wallet,
          {
            where: { id: walletId },
            lock: { mode: 'pessimistic_write' },
          },
        );

        if (!wallet) {
          throw new NotFoundException(`Wallet ${walletId} not found`);
        }

        // Execute wallet operation
        operation(wallet);
        await ctx.manager.save(wallet);

        // Reload saga within this transaction to avoid EntityManager conflicts
        const saga = await ctx.manager.findOne(TransferSaga, {
          where: { id: sagaId },
        });

        if (!saga) {
          throw new NotFoundException(`Saga ${sagaId} not found`);
        }

        // Update saga state if needed
        if (updateSaga) {
          updateSaga(saga);
          await ctx.manager.save(saga);
        }

        // Create event
        const event = new WalletEvent(
          walletId,
          eventType,
          wallet.currency,
          Number(amount),
          eventMetadata,
        );
        await ctx.manager.save(event);

        this.logger.log(logMessage);

        // Outbox Pattern
        ctx.publishEvent(new OutboxEvent(
          walletId,
          eventType,
          {
            eventType,
            walletId,
            amount: Number(amount),
            metadata: eventMetadata,
            timestamp: new Date(),
          }
        ));
      }, {
        isolationLevel: 'READ COMMITTED',
      });
    });
  }

  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    const maxRetries = this.configService.maxRetries;
    const initialBackoffMs = this.configService.initialBackoffMs;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        if (this.isRetryableError(error)) {
          this.logger.warn(`Retry attempt ${attempt + 1}/${maxRetries} due to lock conflict`);
          await this.performExponentialBackoff(attempt, initialBackoffMs);
          
          continue;
        }

        throw error;
      }
    }

    this.logger.error(`Operation failed after ${maxRetries} retries`);
    throw new Error('Operation failed due to concurrent modification. Please retry.');
  }

  private isRetryableError(error: any): boolean {
    // Check for Postgres serialization failure (40001), deadlock (40P01), Optimistic Lock mismatch, or Unique Violation (23505)
    return error.code === '40001' || error.code === '40P01' || error.code === '23505' || error.name === 'OptimisticLockVersionMismatchError';
  }

  private async performExponentialBackoff(attempt: number, initialBackoffMs: number): Promise<void> {
    const backoffMultiplier = Math.pow(2, attempt);
    let backoffMs = backoffMultiplier * initialBackoffMs;
    
    // Cap backoff at 5 seconds to prevent excessive delays
    backoffMs = Math.min(backoffMs, 5000);
    
    // Add jitter to avoid thundering herd
    const jitter = Math.random() * 100;
    backoffMs += jitter;

    await this.sleep(backoffMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
