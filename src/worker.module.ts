import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet } from './modules/wallet/entities/wallet.entity';
import { WalletEvent } from './modules/wallet/entities/wallet-event.entity';
import { IdempotencyKey } from './domain/entities/idempotency-key.entity';
import { TransferSaga } from './modules/transfer/entities/transfer-saga.entity';
import { FraudDetectionConsumer } from './modules/fraud/consumers/fraud-detection.consumer';
import { AppConfigService } from './config/app-config.service';

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
        host: configService.databaseHost,
        port: configService.databasePort,
        username: configService.databaseUser,
        password: configService.databasePassword,
        database: configService.databaseName,
        entities: [Wallet, WalletEvent, IdempotencyKey, TransferSaga],
        synchronize: true, // Auto-create tables (dev only)
        subscribers: [],
      }),
      inject: [AppConfigService],
    }),
  ],
  providers: [
    AppConfigService,
    FraudDetectionConsumer,
  ],
})
export class WorkerModule {}
