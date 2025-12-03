import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_FILTER } from '@nestjs/core';
import { Wallet } from './modules/wallet/entities/wallet.entity';
import { WalletEvent } from './modules/wallet/entities/wallet-event.entity';
import { IdempotencyKey } from './domain/entities/idempotency-key.entity';
import { RedisModule } from './infrastructure/redis/redis.module';
import { OutboxEvent } from './domain/entities/outbox-event.entity';
import { TransferSaga } from './modules/transfer/entities/transfer-saga.entity';
import { FraudAlert } from './modules/fraud/entities/fraud-alert.entity';

import { WalletEventSubscriber } from './infrastructure/database/wallet-event.subscriber';
import { DatabaseMigrationService } from './infrastructure/database/database-migration.service';
import { AppConfigService } from './config/app-config.service';
import { AppConfigModule } from './config/app-config.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { TransferModule } from './modules/transfer/transfer.module';
import { FraudModule } from './modules/fraud/fraud.module';
import { OutboxRelayService } from './infrastructure/messaging/outbox-relay.service';
import { ScheduleModule } from '@nestjs/schedule';
import { SagaRecoveryService } from './workers/saga-recovery.service';
import { RabbitMQModule } from './infrastructure/messaging/rabbitmq.module';
import { WalletExceptionFilter } from './common/filters/wallet-exception.filter';
import { HealthModule } from './health/health.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';


@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: AppConfigService) => ({
        type: 'postgres',
        entities: [Wallet, WalletEvent, IdempotencyKey, TransferSaga, FraudAlert, OutboxEvent],
        synchronize: true, // Auto-create tables (dev only)
        subscribers: [WalletEventSubscriber],
        // Configure replication if read host is provided
        ...(configService.databaseReadHost ? {
          replication: {
            master: {
              host: configService.databaseHost,
              port: configService.databasePort,
              username: configService.databaseUser,
              password: configService.databasePassword,
              database: configService.databaseName,
            },
            slaves: [{
              host: configService.databaseReadHost,
              port: configService.databasePort,
              username: configService.databaseUser,
              password: configService.databasePassword,
              database: configService.databaseName,
            }],
          },
        } : {
          // Standard single connection
          host: configService.databaseHost,
          port: configService.databasePort,
          username: configService.databaseUser,
          password: configService.databasePassword,
          database: configService.databaseName,
        }),
      }),
      inject: [AppConfigService],
    }),
    AppConfigModule,
    RabbitMQModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{
      ttl: 60000,     // 60 seconds
      limit: 100,     // 100 requests per minute per IP
    }]),
    WalletModule,
    TransferModule,
    FraudModule,
    AppConfigModule,
    RedisModule,
    HealthModule,
    DatabaseModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_FILTER,
      useClass: WalletExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    DatabaseMigrationService,
    WalletEventSubscriber,
    OutboxRelayService,
    SagaRecoveryService,
  ],
  exports: [],
})
export class AppModule {}
