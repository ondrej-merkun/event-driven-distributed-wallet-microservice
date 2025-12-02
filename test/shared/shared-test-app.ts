import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '@src/app.module';
import { DataSource } from 'typeorm';

let sharedApp: INestApplication | null = null;
let sharedDataSource: DataSource | null = null;
let moduleRef: TestingModule | null = null;

/**
 * Get or create a shared NestJS application instance for E2E tests.
 * This significantly speeds up test execution by avoiding repeated module initialization.
 * 
 * @returns Shared app instance and data source
 */
export async function getSharedTestApp(): Promise<{
  app: INestApplication;
  dataSource: DataSource;
}> {
  if (!sharedApp) {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    sharedApp = moduleRef.createNestApplication();
    sharedApp.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      })
    );

    sharedDataSource = sharedApp.get(DataSource);
    await sharedApp.init();

    try {
      // Fail fast if DB is not reachable
      await Promise.race([
        sharedDataSource!.query('SELECT 1'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('DB Connection Timeout')), 5000))
      ]);
    } catch (error) {
      console.error('Failed to connect to test database:', error);
      throw error;
    }
  }

  return {
    app: sharedApp,
    dataSource: sharedDataSource!,
  };
}

/**
 * Stop all cron jobs and intervals to prevent lock contention and resource leaks.
 */
export function stopCronJobs(app: INestApplication): void {
  try {
    const { SchedulerRegistry } = require('@nestjs/schedule');
    const schedulerRegistry = app.get(SchedulerRegistry);

    // Stop CronJobs (e.g. @Cron)
    const cronJobs = schedulerRegistry.getCronJobs();
    console.log(`[Test Cleanup] Found ${cronJobs.size} cron jobs to stop`);
    cronJobs.forEach((job: any, key: string) => {
      try {
        console.log(`[Test Cleanup] Stopping cron job: ${key}`);
        job.stop();
      } catch (err) { 
        console.error(`[Test Cleanup] Failed to stop cron job ${key}`, err);
      }
    });

    // Stop Intervals
    const intervals = schedulerRegistry.getIntervals();
    intervals.forEach((key: string) => {
      try {
        schedulerRegistry.deleteInterval(key);
      } catch (err) { }
    });

    // Stop Timeouts
    const timeouts = schedulerRegistry.getTimeouts();
    timeouts.forEach((key: string) => {
      try {
        schedulerRegistry.deleteTimeout(key);
      } catch (err) { }
    });
  } catch (err) {
    console.log('Could not access SchedulerRegistry for stopping jobs');
  }
}

/**
 * Start all cron jobs (only works for CronJobs, not deleted intervals).
 */
export function startCronJobs(app: INestApplication): void {
  try {
    const { SchedulerRegistry } = require('@nestjs/schedule');
    const schedulerRegistry = app.get(SchedulerRegistry);

    const cronJobs = schedulerRegistry.getCronJobs();
    cronJobs.forEach((job: any) => {
      try {
        job.start();
      } catch (err) { }
    });
  } catch (err) {
    console.log('Could not access SchedulerRegistry for starting jobs');
  }
}

/**
 * Cleanup shared app instance after all tests complete.
 * Call this in a global afterAll hook or in the last test suite.
 */
export async function closeSharedTestApp(): Promise<void> {
  if (sharedApp) {
    try {
      // 1. Stop all jobs
      stopCronJobs(sharedApp);
      
      // 2. Wait for any pending async operations (lazy connections) to complete
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 3. Close the app (triggers all onModuleDestroy hooks)
      await sharedApp.close();
      
      // 4. Force close the module to ensure all providers are cleaned up
      if (moduleRef) {
        await moduleRef.close();
      }
      
      // 5. Wait a bit more to ensure everything is cleaned up
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error('Error during test app cleanup:', error);
    } finally {
      sharedApp = null;
      sharedDataSource = null;
      moduleRef = null;
    }
  }
}

/**
 * Start a database transaction for test isolation.
 * Call in beforeEach to ensure each test runs in a clean transaction.
 */
export async function beginTestTransaction(dataSource: DataSource): Promise<void> {
  await dataSource.query('BEGIN');
}

/**
 * Rollback the database transaction to clean up test data.
 * Call in afterEach to undo all changes made during the test.
 */
export async function rollbackTestTransaction(dataSource: DataSource): Promise<void> {
  await dataSource.query('ROLLBACK');
}
