import { Module, Global, OnModuleDestroy, Logger, Inject } from '@nestjs/common';
import * as amqp from 'amqp-connection-manager';
import { AmqpConnectionManager } from 'amqp-connection-manager';
import { AppConfigService } from '../../config/app-config.service';
import { AppConfigModule } from '../../config/app-config.module';

export const RABBITMQ_CONNECTION = 'RABBITMQ_CONNECTION';

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [
    {
      provide: RABBITMQ_CONNECTION,
      useFactory: async (configService: AppConfigService): Promise<AmqpConnectionManager> => {
        const logger = new Logger('RabbitMQConnection');
        const url = configService.rabbitMqUrl;
        const connection = amqp.connect([url]);

        connection.on('connect', () => {
          logger.log('Connected to RabbitMQ');
        });

        connection.on('disconnect', (err) => {
          logger.error('Disconnected from RabbitMQ', err);
        });

        return connection;
      },
      inject: [AppConfigService],
    },
  ],
  exports: [RABBITMQ_CONNECTION],
})
export class RabbitMQModule implements OnModuleDestroy {
  constructor(@Inject(RABBITMQ_CONNECTION) private readonly connection: AmqpConnectionManager) {}

  async onModuleDestroy() {
    if (this.connection) {
      await this.connection.close();
    }
  }
}


