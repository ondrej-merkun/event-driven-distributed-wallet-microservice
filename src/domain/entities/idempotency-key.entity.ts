import { Entity, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';

@Entity('idempotency_keys')
export class IdempotencyKey {
  @PrimaryColumn({ name: 'request_id', type: 'varchar', length: 255 })
  requestId: string;

  @Column({ type: 'jsonb' })
  response: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  constructor(requestId: string, response: Record<string, any>) {
    this.requestId = requestId;
    this.response = response;
  }
}
