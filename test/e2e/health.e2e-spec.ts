import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '@src/app.module';


describe('Health Endpoint E2E Tests', () => {
  let app: INestApplication;
  // let dataSource: DataSource;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    
    // dataSource = moduleFixture.get<DataSource>(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    it('should return 200 when all services are healthy', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('info');
      expect(response.body.info).toHaveProperty('database');
      expect(response.body.info.database.status).toBe('up');
    });

    it('should include database details in health check', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.body.info.database).toMatchObject({
        status: 'up',
      });
    });

    it('should respond quickly (< 1 second)', async () => {
      const start = Date.now();
      
      await request(app.getHttpServer())
        .get('/health')
        .expect(200);
      
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('Health Check Under Load', () => {
    it('should handle concurrent health checks', async () => {
      const requests = Array(5).fill(null).map(() =>
        request(app.getHttpServer())
          .get('/health')
          .expect(200)
      );

      const responses = await Promise.all(requests);
      responses.forEach(response => {
        expect(response.body.status).toBe('ok');
      });
    });
  });
});
