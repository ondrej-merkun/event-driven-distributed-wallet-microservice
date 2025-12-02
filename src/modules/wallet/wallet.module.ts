import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletController } from './controllers/wallet.controller';
import { WalletService } from './services/wallet.service';
import { WalletRepository } from './repositories/wallet.repository';
import { Wallet } from './entities/wallet.entity';
import { WalletEvent } from './entities/wallet-event.entity';
import { AppConfigModule } from '../../config/app-config.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { IdempotencyKey } from '../../domain/entities/idempotency-key.entity';
import { TransferModule } from '../transfer/transfer.module';
import { DatabaseModule } from '../../infrastructure/database/database.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet, WalletEvent, IdempotencyKey]),
    AppConfigModule,
    RedisModule,
    forwardRef(() => TransferModule),
    DatabaseModule,
  ],
  controllers: [WalletController],
  providers: [
    WalletService,
    {
      provide: 'IWalletRepository',
      useClass: WalletRepository,
    },
    WalletRepository,
  ],
  exports: [WalletService, WalletRepository],
})
export class WalletModule {}
