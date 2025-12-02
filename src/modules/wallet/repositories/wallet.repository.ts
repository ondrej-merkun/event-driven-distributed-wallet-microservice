import { Injectable } from '@nestjs/common';
import { DataSource, Repository, EntityManager } from 'typeorm';
import { IWalletRepository } from '../domain/interfaces/wallet.repository.interface';
import { Wallet } from '../entities/wallet.entity';
import { WalletEvent, WalletEventType } from '../entities/wallet-event.entity';

@Injectable()
export class WalletRepository implements IWalletRepository {
  private walletRepo: Repository<Wallet>;
  private eventRepo: Repository<WalletEvent>;

  constructor(private dataSource: DataSource) {
    this.walletRepo = dataSource.getRepository(Wallet);
    this.eventRepo = dataSource.getRepository(WalletEvent);
  }

  async findById(id: string): Promise<Wallet | null> {
    return this.walletRepo.findOne({ where: { id } });
  }

  async findByIdWithLock(id: string, manager?: EntityManager): Promise<Wallet | null> {
    const repo = manager ? manager.getRepository(Wallet) : this.walletRepo;
    const wallet = await repo.findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    return wallet;
  }

  async save(wallet: Wallet): Promise<Wallet> {
    return this.walletRepo.save(wallet);
  }

  // atomic operation
  async saveWithEvent(
    wallet: Wallet,
    eventType: WalletEventType,
    amount?: number,
    metadata?: Record<string, any>,
    manager?: EntityManager,
  ): Promise<Wallet> {
    const execute = async (em: EntityManager) => {
      // Save wallet
      const savedWallet = await em.save(Wallet, wallet);
      
      // Create event
      const event = new WalletEvent(wallet.id, eventType, wallet.currency, amount, metadata);
      await em.save(WalletEvent, event);

      return savedWallet;
    };

    if (manager) {
      return execute(manager);
    }

    return this.runInTransaction(execute);
  }

  /**
   * Get existing wallet or create a new one atomically.
   * Uses INSERT ... ON CONFLICT DO NOTHING with a separate SELECT
   * to handle race conditions correctly.
   * 
   * TODO: Consider using UPSERT (INSERT ... ON CONFLICT DO UPDATE) if we need
   * to track "last accessed" timestamps on wallets.
   */
  async getOrCreate(id: string, currency: string = 'USD', manager?: EntityManager): Promise<Wallet> {
    const execute = async (em: EntityManager) => {
      // First, try to find existing wallet with lock
      let wallet = await em.findOne(Wallet, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (wallet) {
        return wallet;
      }

      // Wallet doesn't exist, try to insert
      // Use INSERT ... ON CONFLICT DO NOTHING to handle race conditions
      await em.createQueryBuilder()
        .insert()
        .into(Wallet)
        .values({ id, currency, balance: 0 })
        .onConflict('("id") DO NOTHING')
        .execute();

      // Now fetch the wallet (either we inserted it, or another transaction did)
      wallet = await em.findOne(Wallet, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!wallet) {
        // This should never happen if the database is functioning correctly
        throw new Error(`Failed to retrieve or create wallet with ID: ${id}`);
      }

      // Check if this is a newly created wallet (balance is 0 and no events)
      // We create the WALLET_CREATED event only if there are no existing events
      const existingEvents = await em.count(WalletEvent, { where: { walletId: id } });
      if (existingEvents === 0) {
        const event = new WalletEvent(id, WalletEventType.WALLET_CREATED, currency);
        await em.save(WalletEvent, event);
      }

      return wallet;
    };

    if (manager) {
      return execute(manager);
    }

    return this.runInTransaction(execute);
  }

  async getEventHistory(walletId: string, limit: number = 100, offset: number = 0): Promise<WalletEvent[]> {
    return this.eventRepo.find({
      where: { walletId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Saves a new event to the event log.
   * Uses insert() instead of save() to enforce immutability
   */
  async saveEvent(event: WalletEvent): Promise<WalletEvent> {
    const result = await this.eventRepo.insert(event);
    event.id = result.identifiers[0].id;
    return event;
  }

  /**
   * Fallback transaction wrapper for operations not called within 
   * an existing transaction context.
   * 
   * TODO: Consider migrating to use TransactionManager service for consistency
   * across the codebase. Currently kept separate to avoid circular dependencies
   * and because repository methods are often called within existing transactions.
   */
  private async runInTransaction<T>(
    operation: (manager: EntityManager) => Promise<T>
  ): Promise<T> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const result = await operation(queryRunner.manager);

      await queryRunner.commitTransaction();

      return result;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
