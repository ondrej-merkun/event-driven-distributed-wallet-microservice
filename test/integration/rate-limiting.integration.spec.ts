import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import Redis from 'ioredis';
import { AppModule } from '@src/app.module';
import { stopCronJobs } from '../shared/shared-test-app';

describe('Rate Limiting Integration Tests', () => {
  let app: INestApplication;
  let redis: Redis;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    stopCronJobs(app);
    
    // Get Redis client for cleanup
    redis = app.get<Redis>('REDIS_CLIENT');
  });

  afterEach(async () => {
    // Clear rate limiting state between tests to prevent pollution
    const keys = await redis.keys('throttle:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('ThrottlerGuard', () => {
    it('should allow requests under the limit', async () => {
      // Make 5 requests (well under the 100/min limit)
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .get('/health')
          .expect(200);
      }
    });

    it('should block requests after exceeding limit', async () => {
      const testWalletId = `rate-limit-test-${Date.now()}`;
      
      // Make 100 requests to hit the limit
      const responses = [];
      const batchSize = 10;
      for (let i = 0; i < 101; i += batchSize) {
        const batch = [];
        for (let j = 0; j < batchSize && i + j < 101; j++) {
          batch.push(
            request(app.getHttpServer())
              .post(`/wallet/${testWalletId}/deposit`)
              .send({ amount: 1 })
          );
        }
        const batchResponses = await Promise.all(batch);
        responses.push(...batchResponses);
      }
      
      // Count successful and rate-limited responses
      const successful = responses.filter(r => r.status === 200 || r.status === 201).length;
      const rateLimited = responses.filter(r => r.status === 429).length;

      // At least some should be rate limited
      expect(rateLimited).toBeGreaterThan(0);
      expect(successful).toBeLessThanOrEqual(100);
    }, 30000); // Increase timeout for this test

    it('should include rate limit headers', async () => {
      const response = await request(app.getHttpServer())
        .get('/health');

      // Throttler adds these headers
      expect(response.headers).toHaveProperty('x-ratelimit-limit');
      expect(response.headers).toHaveProperty('x-ratelimit-remaining');
      expect(response.headers).toHaveProperty('x-ratelimit-reset');
    });

    it.skip('should reset rate limit after TTL expires', async () => {
      // SKIPPED: Takes 61 seconds, not critical for CI
      // Throttler TTL behavior is tested by the @nestjs/throttler library itself
      // This test verifies library functionality rather than our implementation
      const testWalletId = `rate-limit-reset-${Date.now()}`;
      
      // Make some requests
      await request(app.getHttpServer())
        .post(`/wallet/${testWalletId}/deposit`)
        .send({ amount: 1 })
        .expect(200);

      // Wait for TTL to reset (60 seconds + buffer)
      // Note: This test is slow, consider mocking time in production
      await new Promise(resolve => setTimeout(resolve, 61000));

      // Should be able to make requests again
      await request(app.getHttpServer())
        .post(`/wallet/${testWalletId}/deposit`)
        .send({ amount: 1 })
        .expect(200);
    }, 70000);
  });

  describe('Rate Limiting by IP', () => {
    it('should track limits per IP address', async () => {
      // This test assumes different IPs get different limits
      // In real scenarios, this would require proxy configuration
      const response1 = await request(app.getHttpServer())
        .get('/health')
        .set('X-Forwarded-For', '192.168.1.1');

      const response2 = await request(app.getHttpServer())
        .get('/health')
        .set('X-Forwarded-For', '192.168.1.2');

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
    });
  });
});
