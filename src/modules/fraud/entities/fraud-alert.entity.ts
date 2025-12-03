import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('fraud_alerts')
export class FraudAlert {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'wallet_id' })
  @Index()
  walletId!: string;

  @Column({ name: 'alert_type' })
  alertType!: string;

  @Column('jsonb')
  details!: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  constructor(walletId: string, alertType: string, details: Record<string, any>) {
    this.walletId = walletId;
    this.alertType = alertType;
    this.details = details;
  }
}
