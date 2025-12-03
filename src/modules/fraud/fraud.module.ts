import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FraudAlert } from './entities/fraud-alert.entity';
import { FraudDetectionConsumer } from './consumers/fraud-detection.consumer';
import { AppConfigModule } from '../../config/app-config.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { RabbitMQModule } from '../../infrastructure/messaging/rabbitmq.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([FraudAlert]),
    AppConfigModule,
    RedisModule,
    RabbitMQModule,
  ],
  providers: [
    FraudDetectionConsumer,
  ],
  exports: [FraudDetectionConsumer],
})
export class FraudModule {}
