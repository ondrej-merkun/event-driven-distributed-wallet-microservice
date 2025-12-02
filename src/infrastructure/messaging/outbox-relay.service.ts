import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OutboxRepository } from '../repositories/outbox.repository';
import { EventPublisher } from '../messaging/event-publisher.service';

@Injectable()
export class OutboxRelayService implements OnModuleInit {
  private readonly logger = new Logger(OutboxRelayService.name);
  private isProcessing = false;

  constructor(
    private outboxRepository: OutboxRepository,
    private eventPublisher: EventPublisher,
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
    this.isProcessing = true;

    try {
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
    }
  }
}
