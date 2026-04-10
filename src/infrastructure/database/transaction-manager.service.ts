import { Injectable, Logger, ConflictException, Inject } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import Redis from 'ioredis';
import { OutboxRepository } from '../repositories/outbox.repository';
import { EventPublisher } from '../messaging/event-publisher.service';
import { OutboxEvent } from '../../domain/entities/outbox-event.entity';



export interface TransactionOptions {
  isolationLevel?: 'READ COMMITTED' | 'SERIALIZABLE';
  lockKey?: string; // Redis lock key
  lockTtl?: number; // Redis lock TTL in seconds
}

export interface TransactionContext {
  manager: EntityManager;
  publishEvent: (event: OutboxEvent) => void;
}

@Injectable()
export class TransactionManager {
  private readonly logger = new Logger(TransactionManager.name);

  constructor(
    private dataSource: DataSource,
    private outboxRepository: OutboxRepository,
    _eventPublisher: EventPublisher,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  /**
   * Execute a business operation within a database transaction and optional distributed lock.
   * Handles the Outbox Pattern automatically: events added via context.publishEvent
   * are saved to DB and picked up by the outbox relay after commit.
   */
  async execute<T>(
    operation: (context: TransactionContext) => Promise<T>,
    options: TransactionOptions = {},
  ): Promise<T> {
    const { isolationLevel = 'READ COMMITTED', lockKey, lockTtl = 60 } = options;

    // 1. Acquire Distributed Lock (if requested)
    if (lockKey) {
      const acquired = await this.redis.set(lockKey, 'PROCESSING', 'EX', lockTtl, 'NX');
      if (!acquired) {
        this.logger.warn(`Concurrent request detected for lock: ${lockKey}`);
        throw new ConflictException('Concurrent request in progress');
      }
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction(isolationLevel);

    const eventsToPublish: OutboxEvent[] = [];

    try {
      // 2. Execute Business Logic
      const context: TransactionContext = {
        manager: queryRunner.manager,
        publishEvent: (event: OutboxEvent) => {
          eventsToPublish.push(event);
        },
      };

      const result = await operation(context);

      // 3. Save Outbox Events (in same transaction)
      if (eventsToPublish.length > 0) {
        await this.outboxRepository.saveAll(eventsToPublish, queryRunner.manager);
      }

      // 4. Commit Transaction
      await queryRunner.commitTransaction();

      return result;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
      
      // 6. Release Distributed Lock
      if (lockKey) {
        await this.redis.del(lockKey);
      }
    }
  }

}
