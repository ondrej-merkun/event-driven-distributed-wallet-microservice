import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TransferSagaRepository } from '../modules/transfer/repositories/transfer-saga.repository';
import { TransferSagaService } from '../modules/transfer/services/transfer-saga.service';
import { AppConfigService } from '../config/app-config.service';
import { TransferSagaState } from '../modules/transfer/entities/transfer-saga.entity';
import { LessThan } from 'typeorm';

@Injectable()
export class SagaRecoveryService implements OnModuleInit {
  private readonly logger = new Logger(SagaRecoveryService.name);
  private isRecovering = false;

  constructor(
    private sagaRepository: TransferSagaRepository,
    private sagaService: TransferSagaService,
    private configService: AppConfigService,
  ) {}

  onModuleInit() {
    this.logger.log('Saga Recovery Service initialized');
  }

  @Cron(CronExpression.EVERY_10_SECONDS) // Poll frequently for demo/test purposes
  async recoverStuckSagas() {
    // Skip in test environment to avoid lock contention
    if (process.env.NODE_ENV === 'test') return;
    await this.processStuckSagas();
  }

  async processStuckSagas() {
    if (this.isRecovering) return;
    this.isRecovering = true;

    try {
      // Find sagas stuck in DEBITED state for more than configured threshold
      const thresholdMs = this.configService.sagaStuckThreshold;
      const stuckThreshold = new Date(Date.now() - thresholdMs); 
      
      const stuckSagas = await this.sagaRepository.find({
        where: {
          state: TransferSagaState.DEBITED,
          updatedAt: LessThan(stuckThreshold),
        },
        take: 10,
      });

      if (stuckSagas.length === 0) return;

      this.logger.warn(`Found ${stuckSagas.length} stuck sagas. Attempting recovery...`);

      for (const saga of stuckSagas) {
        this.logger.log(`Recovering saga ${saga.id}...`);
        try {
          // Attempt to complete the transfer (Credit Receiver)
          await this.sagaService.recoverSaga(saga.id);
          this.logger.log(`Saga ${saga.id} recovered successfully`);
        } catch (error) {
          this.logger.error(`Failed to recover saga ${saga.id}`, error);
        }
      }
    } catch (error) {
      this.logger.error('Error in saga recovery job', error);
    } finally {
      this.isRecovering = false;
    }
  }
}
