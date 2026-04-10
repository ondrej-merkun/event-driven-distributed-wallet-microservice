import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { OutboxRepository } from '../repositories/outbox.repository';
import { EventPublisher } from '../messaging/event-publisher.service';
import { REDIS_CLIENT } from '../redis/redis.module';

@Injectable()
export class OutboxRelayService implements OnModuleInit {
  private static readonly LOCK_KEY = 'lock:outbox-relay';
  private static readonly LOCK_TTL_SECONDS = 30;

  private readonly logger = new Logger(OutboxRelayService.name);
  private isProcessing = false;

  constructor(
    private outboxRepository: OutboxRepository,
    private eventPublisher: EventPublisher,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  onModuleInit() {
    this.logger.log('Outbox Relay Service initialized');
  }

  @Cron('*/5 * * * * *') // Every 5 seconds (more efficient than every second)
  async handleCron() {
    // Allow testing of outbox relay in integration tests
    // Skip only in unit test environment (when explicitly set)
    // if (process.env.NODE_ENV === 'test') return;
    
    if (this.isProcessing) return;
    let lockAcquired = false;

    try {
      const lockResult = await this.redis.set(
        OutboxRelayService.LOCK_KEY,
        'PROCESSING',
        'EX',
        OutboxRelayService.LOCK_TTL_SECONDS,
        'NX',
      );
      if (!lockResult) return;

      lockAcquired = true;
      this.isProcessing = true;

      const events = await this.outboxRepository.findUnpublished(100); // Larger batch size
      if (events.length === 0) return;

      this.logger.debug(`Processing ${events.length} outbox events`);

      const publishedIds: string[] = [];

      for (const event of events) {
        try {

          await this.eventPublisher.publish(event.payload);
          publishedIds.push(event.id);
        } catch (error) {
          this.logger.error(`Failed to publish event ${event.id}`, error);
          // Continue to next event, retry this one later
        }
      }

      // Mark as published
      if (publishedIds.length > 0) {
        await this.outboxRepository.markAsPublished(publishedIds);
        this.logger.debug(`Published ${publishedIds.length} events`);
      }
    } catch (error) {
      this.logger.error('Error processing outbox', error);
    } finally {
      this.isProcessing = false;

      if (!lockAcquired) {
        return;
      }

      try {
        await this.redis.del(OutboxRelayService.LOCK_KEY);
      } catch (error) {
        this.logger.warn(
          `Failed to release outbox relay lock: ${(error as Error).message}`,
        );
      }
    }
  }
}
