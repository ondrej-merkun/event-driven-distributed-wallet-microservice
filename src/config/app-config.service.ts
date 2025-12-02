import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppConfigService {
  constructor(private configService: ConfigService) {}

  // App
  get port(): number {
    return Number(this.configService.get('PORT') ?? 3_000);
  }

  get nodeEnv(): string {
    return this.configService.get('NODE_ENV') ?? 'development';
  }

  // Database
  get databaseHost(): string {
    return this.configService.getOrThrow('DATABASE_HOST');
  }

  get databasePort(): number {
    return Number(this.configService.get('DATABASE_PORT') ?? 5432);
  }

  get databaseUser(): string {
    return this.configService.getOrThrow('DATABASE_USER');
  }

  get databasePassword(): string {
    return this.configService.getOrThrow('DATABASE_PASSWORD');
  }

  get databaseName(): string {
    return this.configService.getOrThrow('DATABASE_NAME');
  }

  get databaseReadHost(): string | undefined {
    return this.configService.get('DATABASE_READ_HOST');
  }

  // RabbitMQ
  get rabbitMqUrl(): string {
    return this.configService.getOrThrow('RABBITMQ_URL');
  }

  get rabbitMqExchange(): string {
    return this.configService.get('RABBITMQ_EXCHANGE') ?? 'wallet_events';
  }

  get fraudDetectionQueue(): string {
    return this.configService.get('RABBITMQ_QUEUE_FRAUD_DETECTION') ?? 'fraud_detection';
  }

  // Redis
  get redisHost(): string {
    return this.configService.get('REDIS_HOST') ?? 'localhost';
  }

  get redisPort(): number {
    return Number(this.configService.get('REDIS_PORT') ?? 6379);
  }

  // Retry Logic
  get maxRetries(): number {
    return Number(this.configService.get('MAX_RETRIES') ?? 10);
  }

  get initialBackoffMs(): number {
    return Number(this.configService.get('INITIAL_BACKOFF_MS') ?? 50);
  }

  // Fraud Detection
  get fraudDetectionThreshold(): number {
    return Number(this.configService.get('FRAUD_DETECTION_THRESHOLD') ?? 10_000)
  }

  get fraudDetectionMaxWithdrawals(): number {
    return Number(this.configService.get('FRAUD_DETECTION_MAX_WITHDRAWALS') ?? 3);
  }

  get fraudDetectionTimeWindowMinutes(): number {
    return Number(this.configService.get('FRAUD_DETECTION_TIME_WINDOW_MINUTES') ?? 5);
  }

  // Saga Recovery
  get sagaStuckThreshold(): number {
    return Number(this.configService.get('SAGA_STUCK_THRESHOLD') ?? 60000); // Default 60 seconds
  }
}
