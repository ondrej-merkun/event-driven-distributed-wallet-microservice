import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransferSaga } from './entities/transfer-saga.entity';
import { TransferSagaService } from './services/transfer-saga.service';
import { TransferSagaRepository } from './repositories/transfer-saga.repository';
import { WalletModule } from '../wallet/wallet.module';
import { AppConfigModule } from '../../config/app-config.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';

import { DatabaseModule } from '../../infrastructure/database/database.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TransferSaga]),
    forwardRef(() => WalletModule),
    AppConfigModule,
    RedisModule,
    DatabaseModule,
  ],
  providers: [
    TransferSagaService,
    TransferSagaRepository,
  ],
  exports: [TransferSagaService, TransferSagaRepository],
})
export class TransferModule {}
