import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OutboxEvent } from '../../domain/entities/outbox-event.entity';

@Injectable()
export class OutboxRepository {
  // private readonly logger = new Logger(OutboxRepository.name);

  constructor(private dataSource: DataSource) {}

  async save(event: OutboxEvent, manager?: EntityManager): Promise<OutboxEvent> {
    const repo = manager ? manager.getRepository(OutboxEvent) : this.dataSource.getRepository(OutboxEvent);
    return repo.save(event);
  }

  async saveAll(events: OutboxEvent[], manager?: EntityManager): Promise<OutboxEvent[]> {
    const repo = manager ? manager.getRepository(OutboxEvent) : this.dataSource.getRepository(OutboxEvent);
    return repo.save(events);
  }

  async findUnpublished(limit: number = 50): Promise<OutboxEvent[]> {
    return this.dataSource.getRepository(OutboxEvent).find({
      where: { published: false },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  async markAsPublished(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.dataSource.getRepository(OutboxEvent).update(ids, { published: true });
  }
}
