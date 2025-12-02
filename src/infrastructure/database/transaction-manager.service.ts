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
    private eventPublisher: EventPublisher,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  /**
   * Execute a business operation within a database transaction and optional distributed lock.
   * Handles the Outbox Pattern automatically: events added via context.publishEvent are saved to DB and published after commit.
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

      // 5. Publish Events to Broker (Best Effort, Post-Commit)
      // Note: If this fails, the Outbox Relay will pick it up later.
      this.publishEventsAsync(eventsToPublish);

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

  private async publishEventsAsync(events: OutboxEvent[]) {
    if (events.length === 0) return;
    
    // Fire and forget - don't block response
    Promise.allSettled(
      events.map(async (event) => {
        try {
          await this.eventPublisher.publish(event.payload);
          // We could mark as published here, but let's leave that to the relay for simplicity/safety
          // or we could add a method to OutboxRepository to mark specific IDs as published
        } catch (e) {
          this.logger.warn(`Failed to publish event ${event.id} immediately: ${(e as Error).message}`);
        }
      })
    );
  }
}
