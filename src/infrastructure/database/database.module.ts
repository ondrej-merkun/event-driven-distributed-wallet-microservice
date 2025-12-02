import { Module, Global } from '@nestjs/common';
import { TransactionManager } from './transaction-manager.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxRepository } from '../repositories/outbox.repository';
import { EventPublisher } from '../messaging/event-publisher.service';
import { IdempotencyRepository } from '../repositories/idempotency.repository';
import { RedisModule } from '../redis/redis.module';
import { RabbitMQModule } from '../messaging/rabbitmq.module';

@Global()
@Module({
  imports: [
    TypeOrmModule,
    RedisModule, // For TransactionManager lock
    RabbitMQModule,
  ],
  providers: [
    TransactionManager,
    OutboxRepository,
    IdempotencyRepository,
    EventPublisher, // This might need RabbitMQModule if it injects AMQP
  ],
  exports: [
    TransactionManager,
    OutboxRepository,
    IdempotencyRepository,
    EventPublisher,
  ],
})
export class DatabaseModule {}
