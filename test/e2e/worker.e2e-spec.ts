import { Test, TestingModule } from '@nestjs/testing';
import { WorkerModule } from '../../src/worker.module';

describe('Worker Application Boot', () => {
  let app: TestingModule;

  it('should compile the worker module without dependency errors', async () => {
    app = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();

    expect(app).toBeDefined();
    const workerModule = app.get(WorkerModule);
    expect(workerModule).toBeDefined();
    
    await app.close();
  });
});
