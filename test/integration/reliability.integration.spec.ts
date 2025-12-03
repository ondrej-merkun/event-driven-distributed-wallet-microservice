import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { TransferSaga, TransferSagaState } from '@src/modules/transfer/entities/transfer-saga.entity';
import { Wallet } from '@src/modules/wallet/entities/wallet.entity';
import { SagaRecoveryService } from '@src/workers/saga-recovery.service';
import { getSharedTestApp, closeSharedTestApp } from '../shared/shared-test-app';

describe('Reliability E2E Tests', () => {
  jest.setTimeout(20000); // Increased to 20s
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const shared = await getSharedTestApp();
    app = shared.app;
    dataSource = shared.dataSource;
    
    // No need to start cron jobs, we trigger manually
  });

  afterAll(async () => {
    // Close shared app since this is the last test suite
    await closeSharedTestApp();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE wallets, wallet_events, idempotency_keys, transfer_sagas CASCADE');
  });

  describe('Saga Recovery', () => {
    it('should recover a stuck saga (DEBITED -> COMPLETED)', async () => {
      // 1. Setup Wallets
      const senderId = 'sender-recovery';
      const receiverId = 'receiver-recovery';
      
      const res1 = await request(app.getHttpServer()).post(`/wallet/${senderId}/deposit`).send({ amount: 1000 });
      if (res1.status !== 200) console.log('Sender Deposit Failed:', res1.body);
      expect(res1.status).toBe(200);

      const res2 = await request(app.getHttpServer()).post(`/wallet/${receiverId}/deposit`).send({ amount: 10 });
      if (res2.status !== 200) console.log('Receiver Deposit Failed:', res2.body);
      expect(res2.status).toBe(200);

      // 2. Simulate a "Stuck" Saga (Crash after debit)
      // Manually insert Saga in DEBITED state and manually debit sender
      const amount = 100;
      const sagaId = '123e4567-e89b-12d3-a456-426614174000'; // Valid UUID
      
      // Debit sender manually
      await dataSource.manager.decrement(Wallet, { id: senderId }, 'balance', amount);
      
      // Insert stuck saga (simulating it happened 10 mins ago)
      await dataSource.query(`
        INSERT INTO transfer_sagas (id, from_wallet_id, to_wallet_id, amount, state, currency, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '10 minutes')
      `, [sagaId, senderId, receiverId, amount, TransferSagaState.DEBITED, 'USD']);

      // 3. Trigger saga recovery manually
      const sagaRecoveryService = app.get(SagaRecoveryService);
      await sagaRecoveryService.processStuckSagas();

      // 4. Check status
      const saga = await dataSource.getRepository(TransferSaga).findOneBy({ id: sagaId });
      const receiver = await dataSource.getRepository(Wallet).findOneBy({ id: receiverId });

      // EXPECTATION: Saga should be COMPLETED, Receiver balance is 110
      expect(saga?.state).toBe(TransferSagaState.COMPLETED);
      expect(Number(receiver?.balance)).toBe(110);
    }, 30000);
  });
});
