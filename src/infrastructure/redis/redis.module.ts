import { Module, Global, OnModuleDestroy, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfigService } from '../../config/app-config.service';
import { AppConfigModule } from '../../config/app-config.module';
import { Logger } from '@nestjs/common';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * Global Redis module providing a shared Redis client instance.
 * 
 * Known Limitations:
 * - TODO: Add connection pooling for high-throughput scenarios
 * - TODO: Add Redis Cluster support for horizontal scaling
 * - TODO: Add Redis Sentinel support for HA failover
 */
@Global()
@Module({
  imports: [AppConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (configService: AppConfigService) => {
        const redis = new Redis({
          host: configService.redisHost,
          port: configService.redisPort,
          // TODO: Add connection retry strategy for production
          // TODO: Add TLS configuration for secure connections
          lazyConnect: false,
          enableReadyCheck: true,
        });

        redis.on('error', (err) => {
          // Using console here since Logger isn't available in factory context
          // In production, consider using a dedicated error tracking service
          process.stderr.write(`[RedisModule] Redis connection error: ${err.message}\n`);
        });

        return redis;
      },
      inject: [AppConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  private readonly logger = new Logger(RedisModule.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Closing Redis connection...');
    await this.redis.quit();
    this.logger.log('Redis connection closed');
  }
}
