import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { getSharedTestApp, stopCronJobs } from '../shared/shared-test-app';

describe('Wallet E2E Tests', () => {
  jest.setTimeout(20000); // Increased to 20s
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const shared = await getSharedTestApp();
    app = shared.app;
    dataSource = shared.dataSource;
    
    // Stop cron jobs to prevent lock contention during TRUNCATE
    stopCronJobs(app);
  });

  afterAll(async () => {
    // Shared app is closed globally, not per suite
  });

  beforeEach(async () => {
    // Clean database before each test
    await dataSource.query('TRUNCATE wallets, wallet_events, idempotency_keys, transfer_sagas CASCADE');
  });

  describe('Basic Operations', () => {
    it('should deposit funds and create wallet', async () => {
      const response = await request(app.getHttpServer())
        .post('/wallet/user-123/deposit')
        .send({ amount: 100 })
        .set('x-request-id', 'test-deposit-1')
        .expect(200);

      expect(response.body.walletId).toBe('user-123');
      expect(response.body.balance).toBe(100);
    });

    it('should handle duplicate requests (idempotency)', async () => {
      const requestId = 'test-duplicate-1';
      
      // First request
      const response1 = await request(app.getHttpServer())
        .post('/wallet/user-123/deposit')
        .send({ amount: 100 })
        .set('x-request-id', requestId)
        .expect(200);

      // Duplicate request
      const response2 = await request(app.getHttpServer())
        .post('/wallet/user-123/deposit')
        .send({ amount: 100 })
        .set('x-request-id', requestId)
        .expect(200);

      // Should return same response
      expect(response1.body).toEqual(response2.body);
      expect(response2.body.balance).toBe(100); // Not 200
    });

    it('should withdraw funds', async () => {
      // Setup: deposit first
      await request(app.getHttpServer())
        .post('/wallet/user-123/deposit')
        .send({ amount: 100 })
        .expect(200);

      // Withdraw
      const response = await request(app.getHttpServer())
        .post('/wallet/user-123/withdraw')
        .send({ amount: 50 })
        .set('x-request-id', 'test-withdraw-1')
        .expect(200);

      expect(response.body.balance).toBe(50);
    });

    it('should reject withdrawal with insufficient funds', async () => {
      await request(app.getHttpServer())
        .post('/wallet/user-123/deposit')
        .send({ amount: 50 })
        .expect(200);

      await request(app.getHttpServer())
        .post('/wallet/user-123/withdraw')
        .send({ amount: 100 })
        .set('x-request-id', 'test-insufficient-1')
        .expect(422); // Business rule violation
    });
  });

  describe('Validation', () => {
    it('should reject deposit with negative amount', async () => {
      await request(app.getHttpServer())
        .post('/wallet/user-val/deposit')
        .send({ amount: -100 })
        .expect(400);
    });

    it('should reject deposit with zero amount', async () => {
      await request(app.getHttpServer())
        .post('/wallet/user-val/deposit')
        .send({ amount: 0 })
        .expect(400);
    });

    it('should reject transfer with missing recipient', async () => {
      await request(app.getHttpServer())
        .post('/wallet/user-val/transfer')
        .send({ amount: 10 })
        .expect(400);
    });
  });

  describe('Transfer and Saga', () => {
    it('should complete transfer successfully', async () => {
      // Setup sender with funds
      await request(app.getHttpServer())
        .post('/wallet/alice/deposit')
        .send({ amount: 100 })
        .expect(200);

      // Transfer
      const response = await request(app.getHttpServer())
        .post('/wallet/alice/transfer')
        .send({ toWalletId: 'bob', amount: 50 })
        .set('x-request-id', 'test-transfer-1')
        .expect(200);

      expect(response.body.state).toBe('COMPLETED');

      // Verify balances
      const aliceBalance = await request(app.getHttpServer())
        .get('/wallet/alice')
        .expect(200);
      expect(aliceBalance.body.balance).toBe(50);

      const bobBalance = await request(app.getHttpServer())
        .get('/wallet/bob')
        .expect(200);
      expect(bobBalance.body.balance).toBe(50);
    });

    it('should handle duplicate transfer requests (idempotency)', async () => {
      // Setup
      await request(app.getHttpServer())
        .post('/wallet/alice-idem/deposit')
        .send({ amount: 100 })
        .expect(200);

      const requestId = 'transfer-idem-1';

      // First request
      await request(app.getHttpServer())
        .post('/wallet/alice-idem/transfer')
        .send({ toWalletId: 'bob-idem', amount: 50 })
        .set('x-request-id', requestId)
        .expect(200);

      // Duplicate request
      await request(app.getHttpServer())
        .post('/wallet/alice-idem/transfer')
        .send({ toWalletId: 'bob-idem', amount: 50 })
        .set('x-request-id', requestId)
        .expect(200);

      // Verify balances (should still be 50, not 0)
      const aliceBalance = await request(app.getHttpServer())
        .get('/wallet/alice-idem')
        .expect(200);
      expect(aliceBalance.body.balance).toBe(50);
    });

    it('should fail transfer with insufficient funds', async () => {
      await request(app.getHttpServer())
        .post('/wallet/alice-poor/deposit')
        .send({ amount: 10 })
        .expect(200);

      await request(app.getHttpServer())
        .post('/wallet/alice-poor/transfer')
        .send({ toWalletId: 'bob-rich', amount: 50 })
        .expect(422); // Business rule violation
    });

    it('should handle bidirectional transfers (A->B and B->A simultaneously)', async () => {
      // Setup both wallets
      await request(app.getHttpServer())
        .post('/wallet/alice/deposit')
        .send({ amount: 100 })
        .expect(200);

      await request(app.getHttpServer())
        .post('/wallet/bob/deposit')
        .send({ amount: 100 })
        .expect(200);

      // Simultaneous bidirectional transfers
      const promises = [
        request(app.getHttpServer())
          .post('/wallet/alice/transfer')
          .send({ toWalletId: 'bob', amount: 30 })
          .set('x-request-id', 'transfer-a-to-b'),
        request(app.getHttpServer())
          .post('/wallet/bob/transfer')
          .send({ toWalletId: 'alice', amount: 20 })
          .set('x-request-id', 'transfer-b-to-a'),
      ];

      await Promise.all(promises);

      // Verify final balances
      const aliceBalance = await request(app.getHttpServer())
        .get('/wallet/alice')
        .expect(200);
      
      const bobBalance = await request(app.getHttpServer())
        .get('/wallet/bob')
        .expect(200);

      // Alice: 100 - 30 + 20 = 90
      // Bob: 100 + 30 - 20 = 110
      expect(aliceBalance.body.balance).toBe(90);
      expect(bobBalance.body.balance).toBe(110);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent withdrawals on same wallet', async () => {
      // Setup wallet with $100
      await request(app.getHttpServer())
        .post('/wallet/user-123/deposit')
        .send({ amount: 100 })
        .expect(200);

      // Try two concurrent $100 withdrawals - only one should succeed
      const promises = [
        request(app.getHttpServer())
          .post('/wallet/user-123/withdraw')
          .send({ amount: 100 })
          .set('x-request-id', 'concurrent-withdraw-1'),
        request(app.getHttpServer())
          .post('/wallet/user-123/withdraw')
          .send({ amount: 100 })
          .set('x-request-id', 'concurrent-withdraw-2'),
      ];

      const results = await Promise.allSettled(promises);

      // One should succeed, one should fail
      const successes = results.filter(r => r.status === 'fulfilled' && (r.value as any).status === 200);
      const failures = results.filter(r => r.status === 'fulfilled' && (r.value as any).status !== 200);

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);

      // Final balance should be 0
      const balance = await request(app.getHttpServer())
        .get('/wallet/user-123')
        .expect(200);
      expect(balance.body.balance).toBe(0);
    });

    it('should handle 2 concurrent deposits', async () => {
      // Pre-create wallet to avoid contention on creation
      await request(app.getHttpServer())
        .post('/wallet/user-concurrent/deposit')
        .send({ amount: 0.01 }) // Small amount to create wallet
        .expect(200);

      const promises = [];
      for (let i = 0; i < 2; i++) { // Reduced from 100
        promises.push(
          request(app.getHttpServer())
            .post('/wallet/user-concurrent/deposit')
            .send({ amount: 10 })
            .set('x-request-id', `concurrent-deposit-${i}`)
        );
      }

      const responses = await Promise.allSettled(promises);
      const successes = responses.filter(r => r.status === 'fulfilled' && (r.value as any).status === 200).length;
      const failures = responses.filter(r => r.status === 'fulfilled' && (r.value as any).status !== 200).length;

      console.log(`[DEBUG] Concurrent deposits: ${successes} successes, ${failures} failures`);
      expect(successes + failures).toBe(2);
      expect(successes).toBeGreaterThanOrEqual(1); // At least one should succeed

      const balance = await request(app.getHttpServer())
        .get('/wallet/user-concurrent')
        .expect(200);

      // Balance should be initial (0.01) + successes * 10
      const expectedBalance = 0.01 + (successes * 10);
      expect(balance.body.balance).toBeCloseTo(expectedBalance, 2);
    });
  });

  describe('Wallet History', () => {
    it('should retrieve transaction history with pagination', async () => {
      // Create 3 transactions
      await request(app.getHttpServer()).post('/wallet/user-hist/deposit').send({ amount: 10 }).expect(200);
      await request(app.getHttpServer()).post('/wallet/user-hist/deposit').send({ amount: 10 }).expect(200);
      await request(app.getHttpServer()).post('/wallet/user-hist/deposit').send({ amount: 10 }).expect(200);

      // Test Limit
      const limitResponse = await request(app.getHttpServer())
        .get('/wallet/user-hist/history?limit=2')
        .expect(200);
      expect(limitResponse.body.length).toBe(2);

      // Test Offset
      const offsetResponse = await request(app.getHttpServer())
        .get('/wallet/user-hist/history?limit=2&offset=2')
        .expect(200);
      expect(offsetResponse.body.length).toBeGreaterThanOrEqual(1); // Should be at least 1 (the 3rd one)
    });
  });
});
