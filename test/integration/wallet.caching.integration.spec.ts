import { INestApplication } from '@nestjs/common';
// import { DataSource } from 'typeorm';
import { getSharedTestApp } from '../shared/shared-test-app';
import { WalletService } from '@src/modules/wallet/services/wallet.service';
import { WalletRepository } from '@src/modules/wallet/repositories/wallet.repository';
import Redis from 'ioredis';
import * as crypto from 'crypto';

describe('Wallet Caching Integration', () => {
  let app: INestApplication;
  // let dataSource: DataSource;
  let walletService: WalletService;
  let walletRepository: WalletRepository;
  let redisClient: Redis;

  beforeAll(async () => {
    const shared = await getSharedTestApp();
    app = shared.app;
    // dataSource = shared.dataSource;
    walletService = app.get(WalletService);
    walletRepository = app.get('IWalletRepository');
    redisClient = app.get('REDIS_CLIENT');
  });

  beforeEach(async () => {
    // Clean up cache before each test to ensure clean state
    const keys = await redisClient.keys('wallet:balance:*');
    if (keys.length > 0) {
      await redisClient.del(...keys);
    }
  });

  afterEach(async () => {
    // Clean up cache
    const keys = await redisClient.keys('wallet:balance:*');
    if (keys.length > 0) {
      await redisClient.del(...keys);
    }
  });

  it('should cache balance after first getBalance call', async () => {
    const walletId = crypto.randomUUID();
    // Create wallet directly in DB to avoid cache population via deposit
    await walletRepository.getOrCreate(walletId, 'USD');

    const repoSpy = jest.spyOn(walletRepository, 'findById');

    // First call: Should hit DB
    const result1 = await walletService.getBalance(walletId);
    expect(result1.balance).toBe(0);
    expect(repoSpy).toHaveBeenCalledTimes(1);

    // Verify cache is set
    const cached = await redisClient.get(`wallet:balance:${walletId}`);
    expect(cached).toBe('0');

    // Second call: Should hit Cache (repo spy should not increase)
    const result2 = await walletService.getBalance(walletId);
    expect(result2.balance).toBe(0);
    expect(repoSpy).toHaveBeenCalledTimes(1); // Still 1

    repoSpy.mockRestore();
  });

  it('should update cache after deposit', async () => {
    const walletId = crypto.randomUUID();
    await walletService.deposit(walletId, 100);

    // Verify cache is updated
    const cached = await redisClient.get(`wallet:balance:${walletId}`);
    expect(cached).toBe('100');

    // getBalance should hit cache
    const repoSpy = jest.spyOn(walletRepository, 'findById');
    const result = await walletService.getBalance(walletId);
    expect(result.balance).toBe(100);
    expect(repoSpy).not.toHaveBeenCalled();

    repoSpy.mockRestore();
  });

  it('should update cache after withdraw', async () => {
    const walletId = crypto.randomUUID();
    await walletService.deposit(walletId, 100);
    await walletService.withdraw(walletId, 40);

    // Verify cache is updated
    const cached = await redisClient.get(`wallet:balance:${walletId}`);
    expect(cached).toBe('60');

    // getBalance should hit cache
    const repoSpy = jest.spyOn(walletRepository, 'findById');
    const result = await walletService.getBalance(walletId);
    expect(result.balance).toBe(60);
    expect(repoSpy).not.toHaveBeenCalled();

    repoSpy.mockRestore();
  });
});
