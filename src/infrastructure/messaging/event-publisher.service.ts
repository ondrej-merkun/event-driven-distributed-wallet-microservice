import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';

import { AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager';
import { ConfirmChannel, Options } from 'amqplib';
import { RABBITMQ_CONNECTION } from './rabbitmq.module';
import { WalletEventType } from '../../modules/wallet/entities/wallet-event.entity';
import { AppConfigService } from '../../config/app-config.service';

export interface WalletEventMessage {
  eventType: WalletEventType;
  walletId: string;
  amount?: number;
  metadata?: Record<string, any>;
  timestamp: Date;
}

@Injectable()
export class EventPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventPublisher.name);
  private channelWrapper: ChannelWrapper | null = null;
  private readonly exchange: string;

  constructor(
    private readonly configService: AppConfigService,
    @Inject(RABBITMQ_CONNECTION) private readonly connection: AmqpConnectionManager,
  ) {
    this.exchange = this.configService.rabbitMqExchange;
  }

  async onModuleInit(): Promise<void> {
    // Start connection asynchronously without blocking module initialization
    this.connect().catch(err => {
      this.logger.error('Failed to connect EventPublisher', err);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  async publish(event: WalletEventMessage, exchange?: string): Promise<void> {
    if (!this.channelWrapper) {
      throw new Error('EventPublisher not connected');
    }

    const targetExchange = exchange || this.exchange;
    const routingKey = `wallet.${event.eventType.toLowerCase()}`;
    
    try {
      await this.channelWrapper.publish(targetExchange, routingKey, event, {
        persistent: true,
        timestamp: Date.now(),
      } as Options.Publish);
      
      this.logger.log(`Published event: ${event.eventType} for wallet ${event.walletId}`);
    } catch (error) {
      this.logger.error(`Failed to publish event: ${event.eventType}`, error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.channelWrapper) {
      await this.channelWrapper.close();
    }
    // Connection is managed by RabbitMQModule, so we don't close it here
  }

  private async connect(): Promise<void> {
    this.channelWrapper = this.connection.createChannel({
      json: true,
      setup: async (channel: ConfirmChannel) => {
        await channel.assertExchange(this.exchange, 'topic', { durable: true });
        this.logger.log(`Exchange ${this.exchange} asserted`);
      },
    });

    await this.channelWrapper.waitForConnect();
  }
}
