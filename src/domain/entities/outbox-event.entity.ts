import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('outbox_events')
@Index(['published', 'createdAt']) // Optimize unpublished events query
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  aggregateId: string;

  @Column()
  eventType: string;

  @Column('jsonb')
  payload: any;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ default: false })
  published!: boolean;

  constructor(aggregateId: string, eventType: string, payload: any) {
    this.aggregateId = aggregateId;
    this.eventType = eventType;
    this.payload = payload;
  }
}
