import { Injectable } from '@nestjs/common';
import { DataSource, Repository, EntityManager } from 'typeorm';
import { IdempotencyKey } from '../../domain/entities/idempotency-key.entity';

@Injectable()
export class IdempotencyRepository {
  private repository: Repository<IdempotencyKey>;

  constructor(_dataSource: DataSource) {
    this.repository = _dataSource.getRepository(IdempotencyKey);
  }

  async findByRequestId(requestId: string): Promise<IdempotencyKey | null> {
    return this.repository.findOne({ where: { requestId } });
  }

  async save(key: IdempotencyKey, manager?: EntityManager): Promise<IdempotencyKey> {
    const repo = manager ? manager.getRepository(IdempotencyKey) : this.repository;
    return repo.save(key);
  }

  // In production, we'd run this periodically either using a cron or a scheduled task.
  // Currently unused
  async cleanupOld(hoursOld: number): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - hoursOld);
    
    await this.repository
      .createQueryBuilder()
      .delete()
      .where('created_at < :cutoffDate', { cutoffDate })
      .execute();
  }
}
