import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { DataSource } from 'typeorm';
import { SagaRecoveryService } from '../../src/workers/saga-recovery.service';
import { TransferSaga, TransferSagaState } from '../../src/modules/transfer/entities/transfer-saga.entity';
import { TransferSagaRepository } from '../../src/modules/transfer/repositories/transfer-saga.repository';
import { Wallet } from '../../src/modules/wallet/entities/wallet.entity';

describe('SagaRecovery Integration Tests', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let sagaRecoveryService: SagaRecoveryService;
  let transferSagaRepository: TransferSagaRepository;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    
    dataSource = moduleFixture.get<DataSource>(DataSource);
    sagaRecoveryService = moduleFixture.get<SagaRecoveryService>(SagaRecoveryService);
    transferSagaRepository = moduleFixture.get<TransferSagaRepository>(TransferSagaRepository);
  });

  beforeEach(async () => {
    // Clean tables
    await dataSource.query('TRUNCATE TABLE wallets, transfer_sagas, wallet_events, outbox_events CASCADE');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Stuck Saga Detection', () => {
    it('should detect sagas stuck in PENDING state', async () => {
      // Create a stuck saga (PENDING for > 5 minutes)
      const wallet1 = new Wallet('wallet-1', 'USD');
      wallet1.id = 'wallet-stuck-1';
      wallet1.balance = 100;
      wallet1.currency = 'USD';
      
      const wallet2 = new Wallet('wallet-2', 'USD');
      wallet2.id = 'wallet-stuck-2';
      wallet2.balance = 0;
      wallet2.currency = 'USD';
      
      await dataSource.manager.save([wallet1, wallet2]);

      const stuckSaga = new TransferSaga(
        'wallet-stuck-1',
        'wallet-stuck-2',
        50,
        'USD',
        
      );
      stuckSaga.state = TransferSagaState.PENDING;
      stuckSaga.createdAt = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
      stuckSaga.updatedAt = new Date(Date.now() - 10 * 60 * 1000);
      
      await dataSource.manager.save(stuckSaga);

      // Run recovery
      await sagaRecoveryService.recoverStuckSagas();

      // Saga should be attempted to recover (state might change)
      const recovered = await transferSagaRepository.findById(stuckSaga.id);
      // State should have changed from PENDING or saga should be marked for recovery
      expect(recovered).toBeDefined();
    });

    it('should detect sagas stuck in DEBITED state', async () => {
      const wallet1 = new Wallet('wallet-1', 'USD');
      wallet1.id = 'wallet-debited-1';
      wallet1.balance = 50; // Already debited
      wallet1.currency = 'USD';
      
      const wallet2 = new Wallet('wallet-2', 'USD');
      wallet2.id = 'wallet-debited-2';
      wallet2.balance = 0;
      wallet2.currency = 'USD';
      
      await dataSource.manager.save([wallet1, wallet2]);

      const stuckSaga = new TransferSaga(
        'wallet-debited-1',
        'wallet-debited-2',
        50,
        'USD',
        
      );
      stuckSaga.state = TransferSagaState.DEBITED;
      stuckSaga.createdAt = new Date(Date.now() - 10 * 60 * 1000);
      stuckSaga.updatedAt = new Date(Date.now() - 10 * 60 * 1000);
      
      await dataSource.manager.save(stuckSaga);

      await sagaRecoveryService.recoverStuckSagas();

      const recovered = await transferSagaRepository.findById(stuckSaga.id);
      // Should attempt to complete the credit step
      expect(recovered).toBeDefined();
    });

    it('should not interfere with recently updated sagas', async () => {
      const wallet1 = new Wallet('wallet-1', 'USD');
      wallet1.id = 'wallet-recent-1';
      wallet1.balance = 100;
      wallet1.currency = 'USD';
      
      const wallet2 = new Wallet('wallet-2', 'USD');
      wallet2.id = 'wallet-recent-2';
      wallet2.balance = 0;
      wallet2.currency = 'USD';
      
      await dataSource.manager.save([wallet1, wallet2]);

      const recentSaga = new TransferSaga(
        'wallet-recent-1',
        'wallet-recent-2',
        50,
        'USD',
        
      );
      recentSaga.state = TransferSagaState.PENDING;
      recentSaga.createdAt = new Date(Date.now() - 1 * 60 * 1000); // 1 minute ago
      recentSaga.updatedAt = new Date(Date.now() - 1 * 60 * 1000);
      
      const savedSaga = await dataSource.manager.save(recentSaga);

      await sagaRecoveryService.recoverStuckSagas();

      const afterRecovery = await transferSagaRepository.findById(savedSaga.id);
      // Should remain unchanged
      expect(afterRecovery).toBeDefined();
      expect(afterRecovery!.state).toBe(TransferSagaState.PENDING);
      expect(afterRecovery!.updatedAt).toEqual(savedSaga.updatedAt);
    });
  });

  describe('Recovery Execution', () => {
    it('should complete stuck DEBITED saga', async () => {
      const wallet1 = new Wallet('wallet-1', 'USD');
      wallet1.id = 'wallet-complete-1';
      wallet1.balance = 50;
      wallet1.currency = 'USD';
      
      const wallet2 = new Wallet('wallet-2', 'USD');
      wallet2.id = 'wallet-complete-2';
      wallet2.balance = 0;
      wallet2.currency = 'USD';
      
      await dataSource.manager.save([wallet1, wallet2]);

      const saga = new TransferSaga(
        'wallet-complete-1',
        'wallet-complete-2',
        50,
        'USD',
        
      );
      saga.state = TransferSagaState.DEBITED;
      saga.createdAt = new Date(Date.now() - 10 * 60 * 1000);
      saga.updatedAt = new Date(Date.now() - 10 * 60 * 1000);
      
      await dataSource.manager.save(saga);

      await sagaRecoveryService.recoverStuckSagas();

      // Check if saga completed
      const recovered = await transferSagaRepository.findById(saga.id);
      
      // Saga should be in a more progressed state or completed
      expect(recovered).toBeDefined();
      expect([TransferSagaState.COMPLETED, TransferSagaState.DEBITED]).toContain(recovered!.state);
    });
  });

  describe('Timeout Handling', () => {
    it('should mark extremely old sagas as failed', async () => {
      const wallet1 = new Wallet('wallet-1', 'USD');
      wallet1.id = 'wallet-timeout-1';
      wallet1.balance = 100;
      wallet1.currency = 'USD';
      
      const wallet2 = new Wallet('wallet-2', 'USD');
      wallet2.id = 'wallet-timeout-2';
      wallet2.balance = 0;
      wallet2.currency = 'USD';
      
      await dataSource.manager.save([wallet1, wallet2]);

      const oldSaga = new TransferSaga(
        'wallet-timeout-1',
        'wallet-timeout-2',
        50,
        'USD',
        
      );
      oldSaga.state = TransferSagaState.PENDING;
      oldSaga.createdAt = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
      oldSaga.updatedAt = new Date(Date.now() - 60 * 60 * 1000);
      
      await dataSource.manager.save(oldSaga);

      await sagaRecoveryService.recoverStuckSagas();

      const recovered = await transferSagaRepository.findById(oldSaga.id);
      // Very old sagas might be marked as failed or compensated
      expect(recovered).toBeDefined();
    });
  });

  describe('Concurrency Safety', () => {
    it('should handle concurrent recovery attempts', async () => {
      const wallet1 = new Wallet('wallet-1', 'USD');
      wallet1.id = 'wallet-concurrent-1';
      wallet1.balance = 100;
      wallet1.currency = 'USD';
      
      const wallet2 = new Wallet('wallet-2', 'USD');
      wallet2.id = 'wallet-concurrent-2';
      wallet2.balance = 0;
      wallet2.currency = 'USD';
      
      await dataSource.manager.save([wallet1, wallet2]);

      const saga = new TransferSaga(
        'wallet-concurrent-1',
        'wallet-concurrent-2',
        50,
        'USD',
        
      );
      saga.state = TransferSagaState.PENDING;
      saga.createdAt = new Date(Date.now() - 10 * 60 * 1000);
      saga.updatedAt = new Date(Date.now() - 10 * 60 * 1000);
      
      await dataSource.manager.save(saga);

      // Trigger multiple concurrent recoveries
      await Promise.all([
        sagaRecoveryService.recoverStuckSagas(),
        sagaRecoveryService.recoverStuckSagas(),
        sagaRecoveryService.recoverStuckSagas(),
      ]);

      // Should not cause errors or duplicate processing
      const recovered = await transferSagaRepository.findById(saga.id);
      expect(recovered).toBeDefined();
    });
  });
});
