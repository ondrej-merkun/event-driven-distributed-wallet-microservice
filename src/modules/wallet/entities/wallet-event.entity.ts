import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Check, Index } from 'typeorm';

export enum WalletEventType {
  WALLET_CREATED = 'WALLET_CREATED',
  FUNDS_DEPOSITED = 'FUNDS_DEPOSITED',
  FUNDS_WITHDRAWN = 'FUNDS_WITHDRAWN',
  TRANSFER_INITIATED = 'TRANSFER_INITIATED',
  TRANSFER_COMPLETED = 'TRANSFER_COMPLETED',
  TRANSFER_FAILED = 'TRANSFER_FAILED',
  TRANSFER_COMPENSATED = 'TRANSFER_COMPENSATED',
  WALLET_FROZEN = 'WALLET_FROZEN',
  WALLET_UNFROZEN = 'WALLET_UNFROZEN',
  WALLET_CLOSED = 'WALLET_CLOSED',
}

/**
 * WalletEvent represents an immutable audit trail of all wallet state changes.
 * Events are never updated or deleted, only inserted.
 * 
 * Events are published to RabbitMQ for asynchronous processing
 * (e.g., fraud detection, analytics, notifications).
 */
@Entity('wallet_events')
@Index(['walletId', 'createdAt']) // Optimize history queries
@Check('amount IS NULL OR amount >= 0')
export class WalletEvent {
  /* Integer ID instead of string for performance and also we want sequential ordering,
  *  as this is the primary key for the event sourcing log. 
  */
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'wallet_id', type: 'varchar', length: 255 })
  @Index()
  walletId: string;

  @Column({ name: 'event_type', type: 'varchar', length: 50 })
  eventType: WalletEventType;

  @Column({ type: 'varchar', length: 3, comment: 'ISO 4217 currency code' })
  currency: string;

  @Column({ type: 'decimal', precision: 20, scale: 2, nullable: true })
  amount: number | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  constructor(
    walletId: string,
    eventType: WalletEventType,
    currency: string,
    amount?: number,
    metadata?: Record<string, any>
  ) {
    this.walletId = walletId;
    this.eventType = eventType;
    this.currency = currency;
    this.amount = amount || null;
    this.metadata = metadata || null;
  }
}
