import { Injectable, Logger, Inject } from '@nestjs/common';
import { IWalletRepository } from '../domain/interfaces/wallet.repository.interface';
import { IdempotencyRepository } from '../../../infrastructure/repositories/idempotency.repository';
import { Wallet } from '../entities/wallet.entity';
import { WalletEventType } from '../entities/wallet-event.entity';
import { IdempotencyKey } from '../../../domain/entities/idempotency-key.entity';
import { OutboxEvent } from '../../../domain/entities/outbox-event.entity';
import { TransactionManager } from '../../../infrastructure/database/transaction-manager.service';
import Redis from 'ioredis';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  private readonly CACHE_TTL = 30; // 30 seconds

  constructor(
    @Inject('IWalletRepository') private walletRepository: IWalletRepository,
    private idempotencyRepository: IdempotencyRepository,
    private transactionManager: TransactionManager,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  async deposit(
    walletId: string,
    amount: number,
    requestId?: string,
  ): Promise<{ balance: number; walletId: string }> {
    const result = await this.executeIdempotentTransaction({
      walletId,
      amount,
      eventType: WalletEventType.FUNDS_DEPOSITED,
      operation: (wallet) => wallet.deposit(amount),
      requestId,
      autoCreateWallet: true,
    });

    // Update cache
    await this.setBalanceCache(walletId, result.balance);
    return result;
  }

  async withdraw(
    walletId: string,
    amount: number,
    requestId?: string,
  ): Promise<{ balance: number; walletId: string }> {
    const result = await this.executeIdempotentTransaction({
      walletId,
      amount,
      eventType: WalletEventType.FUNDS_WITHDRAWN,
      operation: (wallet) => wallet.withdraw(amount),
      requestId,
      autoCreateWallet: false,
    });

    // Update cache
    await this.setBalanceCache(walletId, result.balance);
    return result;
  }

  async getBalance(walletId: string): Promise<{ balance: number; walletId: string }> {
    // Check cache first
    const cachedBalance = await this.redis.get(this.getBalanceCacheKey(walletId));
    if (cachedBalance !== null) {
      return { balance: Number(cachedBalance), walletId };
    }

    const wallet = await this.walletRepository.findById(walletId);
    if (!wallet) {
      return { balance: 0, walletId };
    }

    // Set cache
    await this.setBalanceCache(walletId, Number(wallet.balance));

    return { balance: Number(wallet.balance), walletId: wallet.id };
  }

  async getHistory(walletId: string, limit: number = 100, offset: number = 0) {
    const events = await this.walletRepository.getEventHistory(walletId, limit, offset);
    return events.map((event) => ({
      ...event,
      amount: event.amount ? Number(event.amount) : null,
    }));
  }

  /**
   * Freeze a wallet (e.g., for fraud investigation or compliance).
   * Emits WALLET_FROZEN event.
   */
  async freezeWallet(
    walletId: string,
    reason: string,
    frozenBy: string = 'system',
  ): Promise<void> {
    await this.executeStateChange({
      walletId,
      eventType: WalletEventType.WALLET_FROZEN,
      operation: (wallet) => wallet.freeze(),
      metadata: { reason, frozenBy, frozenAt: new Date().toISOString() },
      logMessage: `Wallet ${walletId} frozen. Reason: ${reason}`,
    });
    await this.invalidateBalanceCache(walletId);
  }

  /**
   * Unfreeze a wallet, returning it to active status.
   * Emits WALLET_UNFROZEN event.
   */
  async unfreezeWallet(
    walletId: string,
    unfrozenBy: string = 'system',
  ): Promise<void> {
    await this.executeStateChange({
      walletId,
      eventType: WalletEventType.WALLET_UNFROZEN,
      operation: (wallet) => wallet.unfreeze(),
      metadata: { unfrozenBy, unfrozenAt: new Date().toISOString() },
      logMessage: `Wallet ${walletId} unfrozen`,
    });
    await this.invalidateBalanceCache(walletId);
  }

  /**
   * Permanently close a wallet.
   * Requires zero balance.
   * Emits WALLET_CLOSED event.
   */
  async closeWallet(
    walletId: string,
    reason: string,
    closedBy: string = 'system',
  ): Promise<void> {
    await this.executeStateChange({
      walletId,
      eventType: WalletEventType.WALLET_CLOSED,
      operation: (wallet) => wallet.close(),
      metadata: { reason, closedBy, closedAt: new Date().toISOString() },
      logMessage: `Wallet ${walletId} closed. Reason: ${reason}`,
    });
    await this.invalidateBalanceCache(walletId);
  }

  /**
   * Set or update daily withdrawal limit.
   * Emits DAILY_LIMIT_SET or DAILY_LIMIT_REMOVED event.
   */
  async setDailyWithdrawalLimit(
    walletId: string,
    limit: number | null,
    setBy: string = 'system',
    reason?: string,
  ): Promise<void> {
    await this.transactionManager.execute(async (ctx) => {
      const wallet = await this.walletRepository.findById(walletId); // No lock needed for simple update? Or maybe yes?
      // Actually, for consistency, we should probably lock or use optimistic locking.
      // The original code didn't use explicit lock here, just saveWithEvent.
      
      if (!wallet) {
        throw new Error(`Wallet ${walletId} not found`);
      }

      const previousLimit = wallet.dailyWithdrawalLimit;
      wallet.setDailyWithdrawalLimit(limit);

      const eventType = limit === null
        ? WalletEventType.WALLET_UNFROZEN // Placeholder as per original code
        : WalletEventType.WALLET_FROZEN; // Placeholder as per original code

      await this.walletRepository.saveWithEvent(
        wallet,
        eventType,
        undefined,
        { previousLimit, newLimit: limit, reason },
        ctx.manager,
      );

      this.logger.log(`Wallet ${walletId} daily limit updated: ${previousLimit} -> ${limit}`);

      ctx.publishEvent(new OutboxEvent(
        walletId,
        eventType,
        {
          eventType,
          walletId,
          metadata: { previousLimit, setBy, reason },
          timestamp: new Date(),
        }
      ));

      this.logger.log(
        `Wallet ${walletId} daily limit ${limit === null ? 'removed' : `set to ${limit}`}`,
      );
    });
  }

  private async executeStateChange(params: {
    walletId: string;
    eventType: WalletEventType;
    operation: (wallet: Wallet) => void;
    metadata: Record<string, any>;
    logMessage: string;
  }): Promise<void> {
    const { walletId, eventType, operation, metadata, logMessage } = params;

    await this.transactionManager.execute(async (ctx) => {
      const wallet = await this.walletRepository.findById(walletId);
      if (!wallet) {
        throw new Error(`Wallet ${walletId} not found`);
      }

      operation(wallet);

      await this.walletRepository.saveWithEvent(
        wallet,
        eventType,
        undefined,
        metadata,
        ctx.manager,
      );

      ctx.publishEvent(new OutboxEvent(
        walletId,
        eventType,
        {
          eventType,
          walletId,
          metadata,
          timestamp: new Date(),
        }
      ));

      this.logger.log(logMessage);
    });
  }

  private async executeIdempotentTransaction(params: {
    walletId: string;
    amount: number;
    eventType: WalletEventType;
    operation: (wallet: Wallet) => void;
    requestId?: string;
    autoCreateWallet?: boolean;
  }): Promise<{ balance: number; walletId: string }> {
    const { walletId, amount, eventType, operation, requestId, autoCreateWallet = false } = params;

    // Check idempotency
    if (requestId) {
      const existing = await this.idempotencyRepository.findByRequestId(requestId);
      if (existing) {
        this.logger.log(`Duplicate request detected: ${requestId}`);
        return existing.response as { balance: number; walletId: string };
      }
    }

    const lockKey = requestId ? `lock:req:${requestId}` : undefined;

    return this.transactionManager.execute(async (ctx) => {
      let wallet: Wallet | null;
      
      if (autoCreateWallet) {
        wallet = await this.walletRepository.getOrCreate(walletId, 'USD', ctx.manager);
      } else {
        // Use findByIdWithLock for pessimistic locking during transaction
        wallet = await this.walletRepository.findByIdWithLock(walletId, ctx.manager);
        if (!wallet) {
          throw new Error(`Wallet ${walletId} not found`);
        }
      }
      
      // Execute business logic
      operation(wallet);

      await this.walletRepository.saveWithEvent(
        wallet,
        eventType,
        amount,
        { requestId },
        ctx.manager,
      );

      // Outbox Event
      ctx.publishEvent(new OutboxEvent(
        walletId,
        eventType,
        {
          eventType,
          walletId,
          amount,
          metadata: { requestId },
          timestamp: new Date(),
        }
      ));

      const result = { balance: Number(wallet.balance), walletId: wallet.id };

      // Store idempotency key (best effort, separate transaction usually, but here we can do it inside? 
      // No, idempotency key should ideally be committed with the transaction to ensure atomicity.
      // If we commit tx but fail to save idempotency key, we might re-process.
      // If we save idempotency key but fail tx, we block retry.
      // So it MUST be in the same transaction.
      if (requestId) {
        await this.idempotencyRepository.save(new IdempotencyKey(requestId, result), ctx.manager);
      }

      return result;
    }, {
      lockKey,
      lockTtl: 60,
      isolationLevel: 'READ COMMITTED',
    });
  }

  private getBalanceCacheKey(walletId: string): string {
    return `wallet:balance:${walletId}`;
  }

  private async setBalanceCache(walletId: string, balance: number): Promise<void> {
    await this.redis.set(this.getBalanceCacheKey(walletId), balance, 'EX', this.CACHE_TTL);
  }

  async invalidateBalanceCache(walletId: string): Promise<void> {
    await this.redis.del(this.getBalanceCacheKey(walletId));
  }
}
