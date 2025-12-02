import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { WalletEvent, WalletEventType } from '../../src/modules/wallet/entities/wallet-event.entity';
import { WalletEventSubscriber } from '../../src/infrastructure/database/wallet-event.subscriber';

describe('WalletEvent Immutability', () => {
  let dataSource: DataSource;
  let eventRepo: any;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: process.env.DATABASE_HOST || 'localhost',
          port: parseInt(process.env.DATABASE_PORT || '5432'),
          username: process.env.DATABASE_USER || 'wallet_user',
          password: process.env.DATABASE_PASSWORD || 'wallet_pass',
          database: process.env.DATABASE_NAME || 'wallet_db',
          entities: [WalletEvent],
          subscribers: [WalletEventSubscriber],
          synchronize: true,
        }),
      ],
    }).compile();

    dataSource = module.get<DataSource>(DataSource);
    eventRepo = dataSource.getRepository(WalletEvent);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('should allow creating new events', async () => {
    const event = new WalletEvent('test-wallet', WalletEventType.WALLET_CREATED, 'USD');
    const result = await eventRepo.insert(event);
    
    expect(result.identifiers).toHaveLength(1);
    expect(result.identifiers[0].id).toBeDefined();
  });

  it('should prevent updating existing events', async () => {
    // Create an event
    const event = new WalletEvent('test-wallet-2', WalletEventType.FUNDS_DEPOSITED, 'USD', 100);
    const result = await eventRepo.insert(event);
    const eventId = result.identifiers[0].id;

    // Try to update it
    const existingEvent = await eventRepo.findOne({ where: { id: eventId } });
    existingEvent.amount = 999;

    // Should throw error
    await expect(eventRepo.save(existingEvent)).rejects.toThrow(
      'WalletEvent is immutable'
    );
  });

  it('should prevent deleting events', async () => {
    // Create an event
    const event = new WalletEvent('test-wallet-3', WalletEventType.FUNDS_WITHDRAWN, 'USD', 50);
    const result = await eventRepo.insert(event);
    const eventId = result.identifiers[0].id;

    // Try to delete it
    const existingEvent = await eventRepo.findOne({ where: { id: eventId } });

    // Should throw error
    await expect(eventRepo.remove(existingEvent)).rejects.toThrow(
      'WalletEvent is immutable'
    );
  });
});
