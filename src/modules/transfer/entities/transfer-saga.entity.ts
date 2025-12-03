import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum TransferSagaState {
  PENDING = 'PENDING',
  DEBITED = 'DEBITED',
  COMPLETED = 'COMPLETED',
  COMPENSATED = 'COMPENSATED',
  FAILED = 'FAILED',
}

/**
 * TransferSaga entity for transfer orchestration and history.
 * 
 * Design Note:
 * This entity serves dual purposes:
 * 1. Orchestration: Track transfer state machine (PENDING → DEBITED → COMPLETED)
 * 2. Queries: Transfer history and compliance reporting
 * 
 * In a production system following CQRS best practices, these concerns would be separated:
 * - TransferSaga (write model): Orchestration only, no currency field
 * - TransferHistory (read model): Query-optimized, built from events
 * 
 * For this implementation, we use a single entity for simplicity while acknowledging
 * the architectural trade-off.
 */
@Entity('transfer_sagas')
export class TransferSaga {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'from_wallet_id', type: 'varchar', length: 255 })
  fromWalletId: string;

  @Column({ name: 'to_wallet_id', type: 'varchar', length: 255 })
  toWalletId: string;

  @Column({ type: 'decimal', precision: 20, scale: 2 })
  amount: number;

  @Column({ type: 'varchar', length: 3, comment: 'ISO 4217 currency code for the transfer' })
  currency: string; // Included for query purposes

  @Column({ type: 'varchar', length: 50 })
  state: TransferSagaState;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  constructor(fromWalletId: string, toWalletId: string, amount: number, currency: string) {
    this.fromWalletId = fromWalletId;
    this.toWalletId = toWalletId;
    this.amount = amount;
    this.currency = currency;
    this.state = TransferSagaState.PENDING;
    this.metadata = null;
  }

  markAsDebited(): void {
    if (this.state !== TransferSagaState.PENDING) {
      throw new Error(`Cannot mark as debited from state: ${this.state}`);
    }
    this.state = TransferSagaState.DEBITED;
  }

  markAsCompleted(): void {
    if (this.state !== TransferSagaState.DEBITED) {
      throw new Error(`Cannot mark as completed from state: ${this.state}`);
    }
    this.state = TransferSagaState.COMPLETED;
  }

  markAsCompensated(error: string): void {
    if (this.state !== TransferSagaState.DEBITED) {
      throw new Error(`Cannot compensate from state: ${this.state}`);
    }
    this.state = TransferSagaState.COMPENSATED;
    this.metadata = { ...this.metadata, compensationReason: error };
  }

  markAsFailed(error: string): void {
    this.state = TransferSagaState.FAILED;
    this.metadata = { ...this.metadata, failureReason: error };
  }
}
