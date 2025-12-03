import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { DataSource } from 'typeorm';
import { OutboxRepository } from '../../src/infrastructure/repositories/outbox.repository';
import { OutboxEvent } from '../../src/domain/entities/outbox-event.entity';
import { WalletEventType } from '../../src/modules/wallet/entities/wallet-event.entity';
import { OutboxRelayService } from '../../src/infrastructure/messaging/outbox-relay.service';

describe('OutboxRelay Integration Tests', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let outboxRepository: OutboxRepository;
  let outboxRelayService: OutboxRelayService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    
    dataSource = moduleFixture.get<DataSource>(DataSource);
    outboxRepository = moduleFixture.get<OutboxRepository>(OutboxRepository);
    outboxRelayService = moduleFixture.get<OutboxRelayService>(OutboxRelayService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean outbox table
    await dataSource.query('TRUNCATE TABLE outbox_events CASCADE');
  });

  describe('Event Publishing Flow', () => {
    it('should handle batch processing correctly', async () => {
      // Create more events than batch size
      const batchSize = 100;
      const totalEvents = 150;
      
      const events = [];
      for (let i = 0; i < totalEvents; i++) {
        events.push(new OutboxEvent(
          `wallet-${i}`,
          WalletEventType.FUNDS_DEPOSITED,
          { eventType: WalletEventType.FUNDS_DEPOSITED, walletId: `wallet-${i}`, amount: i }
        ));
      }

      await dataSource.manager.save(events);

      // First batch
      await outboxRelayService.handleCron();
      let unpublished = await outboxRepository.findUnpublished(200);
      expect(unpublished.length).toBe(totalEvents - batchSize);

      // Second batch
      await outboxRelayService.handleCron();
      unpublished = await outboxRepository.findUnpublished(200);
      expect(unpublished.length).toBe(0);
    });
  });

  describe('Concurrency Safety', () => {
    it('should handle concurrent cron executions gracefully', async () => {
      // Create events
      const events = Array(10).fill(null).map((_, i) =>
        new OutboxEvent(
          `wallet-${i}`,
          WalletEventType.FUNDS_DEPOSITED,
          { eventType: WalletEventType.FUNDS_DEPOSITED, walletId: `wallet-${i}`, amount: i }
        )
      );
      await dataSource.manager.save(events);

      // Trigger multiple concurrent executions
      const executions = [
        outboxRelayService.handleCron(),
        outboxRelayService.handleCron(),
        outboxRelayService.handleCron(),
      ];

      await Promise.all(executions);

      // All events should be published exactly once
      const unpublished = await outboxRepository.findUnpublished(20);
      expect(unpublished.length).toBe(0);

      // Verify no duplicate publishes (would need event tracking in real scenario)
    });
  });

  describe('Performance', () => {
    it('should process 100 events in under 5 seconds', async () => {
      const events = Array(100).fill(null).map((_, i) =>
        new OutboxEvent(
          `wallet-${i}`,
          WalletEventType.FUNDS_DEPOSITED,
          { eventType: WalletEventType.FUNDS_DEPOSITED, walletId: `wallet-${i}`, amount: i }
        )
      );
      await dataSource.manager.save(events);

      const start = Date.now();
      await outboxRelayService.handleCron();
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(5000);

      const unpublished = await outboxRepository.findUnpublished(200);
      expect(unpublished.length).toBe(0);
    }, 10000);
  });
});
