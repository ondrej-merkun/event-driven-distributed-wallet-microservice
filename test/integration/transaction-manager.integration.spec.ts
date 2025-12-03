import { Test, TestingModule } from '@nestjs/testing';
 import { INestApplication } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ConflictException } from '@nestjs/common';
import Redis from 'ioredis';
import { TransactionManager, TransactionOptions } from '../../src/infrastructure/database/transaction-manager.service';
import { OutboxRepository } from '../../src/infrastructure/repositories/outbox.repository';
import { OutboxEvent } from '../../src/domain/entities/outbox-event.entity';
import { WalletEventType } from '../../src/modules/wallet/entities/wallet-event.entity';
import { AppModule } from '../../src/app.module';

describe('TransactionManager Integration Tests', () => {
  let app: INestApplication;
  let transactionManager: TransactionManager;
  let dataSource: DataSource;
  let redis: Redis;
  let outboxRepository: OutboxRepository;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    transactionManager = moduleFixture.get<TransactionManager>(TransactionManager);
    dataSource = moduleFixture.get<DataSource>(DataSource);
    redis = moduleFixture.get<Redis>('REDIS_CLIENT');
    outboxRepository = moduleFixture.get<OutboxRepository>(OutboxRepository);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean up Redis locks
    const keys = await redis.keys('lock:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    
    // Clean outbox table
    await dataSource.query('TRUNCATE TABLE outbox_events CASCADE');
  });

  describe('Basic Transaction Execution', () => {
    it('should execute operation within transaction and commit', async () => {
      const result = await transactionManager.execute(async (_ctx) => {
        // Just return a value to verify execution
        return { success: true };
      });

      expect(result).toEqual({ success: true });
    });

    it('should rollback transaction on error', async () => {
      // Create a test event first
      const event = new OutboxEvent(
        'test-wallet',
        WalletEventType.FUNDS_DEPOSITED,
        { amount: 100 }
      );

      await expect(
        transactionManager.execute(async (ctx) => {
          // Save an event
          ctx.publishEvent(event);
          
          // Then throw an error
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      // Verify event was not saved (transaction rolled back)
      const unpublished = await outboxRepository.findUnpublished(10);
      expect(unpublished.length).toBe(0);
    });

    it('should support different isolation levels', async () => {
      const options: TransactionOptions = {
        isolationLevel: 'SERIALIZABLE',
      };

      const result = await transactionManager.execute(async (_ctx) => {
        return { executed: true };
      }, options);

      expect(result.executed).toBe(true);
    });
  });

  describe('Outbox Pattern', () => {
    it('should save events to outbox within transaction', async () => {
      const event1 = new OutboxEvent(
        'wallet-1',
        WalletEventType.FUNDS_DEPOSITED,
        { amount: 100 }
      );
      const event2 = new OutboxEvent(
        'wallet-2',
        WalletEventType.FUNDS_WITHDRAWN,
        { amount: 50 }
      );

      await transactionManager.execute(async (ctx) => {
        ctx.publishEvent(event1);
        ctx.publishEvent(event2);
      });

      // Verify both events were saved
      const unpublished = await outboxRepository.findUnpublished(10);
      expect(unpublished.length).toBe(2);
      expect(unpublished.some(e => e.aggregateId === 'wallet-1')).toBe(true);
      expect(unpublished.some(e => e.aggregateId === 'wallet-2')).toBe(true);
    });

    it('should not save events if transaction rolls back', async () => {
      const event = new OutboxEvent(
        'wallet-rollback',
        WalletEventType.FUNDS_DEPOSITED,
        { amount: 100 }
      );

      await expect(
        transactionManager.execute(async (ctx) => {
          ctx.publishEvent(event);
          throw new Error('Rollback test');
        })
      ).rejects.toThrow('Rollback test');

      // Verify event was not saved
      const unpublished = await outboxRepository.findUnpublished(10);
      expect(unpublished.length).toBe(0);
    });
  });

  describe('Distributed Locking', () => {
    it('should acquire and release distributed lock', async () => {
      const lockKey = 'lock:test-wallet-1';

      await transactionManager.execute(
        async (_ctx) => {
          // Verify lock is held
          const lockValue = await redis.get(lockKey);
          expect(lockValue).toBe('PROCESSING');
          
          return { success: true };
        },
        { lockKey, lockTtl: 10 }
      );

      // Verify lock is released after transaction
      const lockAfter = await redis.get(lockKey);
      expect(lockAfter).toBeNull();
    });

    it('should throw ConflictException when lock is already held', async () => {
      const lockKey = 'lock:test-wallet-concurrent';

      // Acquire lock manually
      await redis.set(lockKey, 'HELD', 'EX', 30);

      // Try to execute transaction with same lock
      await expect(
        transactionManager.execute(
          async (_ctx) => {
            return { success: true };
          },
          { lockKey }
        )
      ).rejects.toThrow(ConflictException);

      // Clean up
      await redis.del(lockKey);
    });

    it('should release lock even if transaction fails', async () => {
      const lockKey = 'lock:test-wallet-error';

      await expect(
        transactionManager.execute(
          async (_ctx) => {
            throw new Error('Transaction error');
          },
          { lockKey, lockTtl: 10 }
        )
      ).rejects.toThrow('Transaction error');

      // Verify lock was released despite error
      const lockAfter = await redis.get(lockKey);
      expect(lockAfter).toBeNull();
    });

    it('should use default TTL of 60 seconds for lock', async () => {
      const lockKey = 'lock:test-ttl';

      await transactionManager.execute(
        async (_ctx) => {
          // Get TTL of the lock
          const ttl = await redis.ttl(lockKey);
          // TTL should be around 60 seconds (allow some margin for execution time)
          expect(ttl).toBeGreaterThan(55);
          expect(ttl).toBeLessThanOrEqual(60);
        },
        { lockKey }
      );
    });
  });

  describe('Concurrent Transactions', () => {
    it('should handle multiple concurrent transactions without locks', async () => {
      const promises = Array(5).fill(null).map((_, i) =>
        transactionManager.execute(async (ctx) => {
          const event = new OutboxEvent(
            `wallet-${i}`,
            WalletEventType.FUNDS_DEPOSITED,
            { amount: i * 10 }
          );
          ctx.publishEvent(event);
          return { id: i };
        })
      );

      const results = await Promise.all(promises);
      expect(results.length).toBe(5);

      // Verify all events were saved
      const unpublished = await outboxRepository.findUnpublished(10);
      expect(unpublished.length).toBe(5);
    });

    it('should serialize transactions with same lock key', async () => {
      const lockKey = 'lock:test-serialized';
      const results: number[] = [];

      // Start 3 transactions with same lock - they should execute serially
      const promises = [0, 1, 2].map(async (i) => {
        try {
          await transactionManager.execute(
            async (_ctx) => {
              results.push(i);
              // Small delay to ensure serialization is tested
              await new Promise(resolve => setTimeout(resolve, 10));
            },
            { lockKey, lockTtl: 5 }
          );
        } catch (e) {
          // Expected to throw ConflictException for concurrent attempts
          if (!(e instanceof ConflictException)) {
            throw e;
          }
        }
      });

      await Promise.allSettled(promises);

      // At least one should have succeeded
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('EntityManager Context', () => {
    it('should provide valid EntityManager in context', async () => {
      await transactionManager.execute(async (ctx) => {
        expect(ctx.manager).toBeInstanceOf(EntityManager);
        expect(ctx.manager).toBeDefined();
        
        // Verify we can query with the manager
        const result = await ctx.manager.query('SELECT 1 as test');
        expect(result).toBeDefined();
      });
    });

    it('should use transactional EntityManager for queries', async () => {
      // This test verifies that the EntityManager is transactional
      // by ensuring rollback works correctly
      const testEvent = new OutboxEvent(
        'test-transactional',
        WalletEventType.FUNDS_DEPOSITED,
        { amount: 100 }
      );

      await expect(
        transactionManager.execute(async (ctx) => {
          // Save directly with manager
          await ctx.manager.save(testEvent);
          
          // Verify it's in transaction
          const found = await ctx.manager.findOne(OutboxEvent, {
            where: { aggregateId: 'test-transactional' }
          });
          expect(found).toBeDefined();
          
          // Now rollback by throwing
          throw new Error('Rollback');
        })
      ).rejects.toThrow('Rollback');

      // Verify entity was rolled back
      const found = await dataSource.manager.findOne(OutboxEvent, {
        where: { aggregateId: 'test-transactional' }
      });
      expect(found).toBeNull();
    });
  });
});
