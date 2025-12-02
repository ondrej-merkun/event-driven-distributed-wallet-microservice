import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn, VersionColumn } from 'typeorm';
import {
  InsufficientFundsError,
  WalletNotActiveError,
  WithdrawalLimitExceededError,
  InvalidAmountError,
  WalletClosedError,
  NonZeroBalanceError,
} from '../../../domain/exceptions/wallet.exceptions';

export enum WalletStatus {
  ACTIVE = 'ACTIVE',  // Normal operations allowed
  FROZEN = 'FROZEN',  // Temporarily suspended (fraud, compliance)
  CLOSED = 'CLOSED',  // Permanently closed, no operations allowed
}

/**
 * Wallet entity representing a user's financial account.
 * 
 * Features:
 * - Balance tracking with optimistic locking
 * - Status management (active, frozen, closed)
 * - Currency support
 * - Withdrawal limits for risk management
 */
@Entity('wallets')
export class Wallet {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  id: string;

  /**
   * Monetary balance stored as PostgreSQL DECIMAL for database-level precision.
   * 
   * PRECISION CONSIDERATIONS:
   * - PostgreSQL DECIMAL(20,2) provides exact storage (no floating-point errors)
   * - TypeORM transforms to JavaScript number for API compatibility
   * - JavaScript numbers are IEEE 754 doubles (safe for amounts up to ~9 quadrillion cents)
   * 
   * TODO: For high-precision requirements (cryptocurrency, forex), we'd consider:
   * - Using Decimal.js library for all arithmetic operations
   * - Storing amounts as integer cents (multiply by 100)
   * - Using string type in DTOs to avoid JSON floating-point issues
   * - Adding validation for maximum decimal places
   * 
   * Current implementation is suitable for standard fiat currency operations
   * where amounts are typically under $1 billion with 2 decimal places.
   */
  @Column({ 
    type: 'decimal', 
    precision: 20,
    scale: 2,
    default: 0,
    transformer: {
      // TypeORM returns PostgreSQL decimal as string, transform to number
      // Note: This is safe for typical currency amounts but may lose precision
      // for very large amounts (> Number.MAX_SAFE_INTEGER / 100)
      to: (value: number) => value,
      from: (value: string) => parseFloat(value)
    }
  })
  balance: number;

  @Column({ 
    type: 'varchar', 
    length: 3, 
    default: 'USD',
    comment: 'ISO 4217 currency code (USD, EUR, GBP, etc.)'
  })
  currency: string;

  @Column({ 
    type: 'enum', 
    enum: WalletStatus, 
    default: WalletStatus.ACTIVE,
    comment: 'Wallet operational status'
  })
  status: WalletStatus;

  @Column({ 
    type: 'decimal', 
    precision: 20, 
    scale: 2, 
    nullable: true,
    name: 'daily_withdrawal_limit',
    comment: 'Maximum withdrawal amount per day (null = no limit)',
    transformer: {
      to: (value: number | null) => value,
      from: (value: string | null) => value === null ? null : parseFloat(value)
    }
  })
  dailyWithdrawalLimit: number | null;

  @Column({ 
    type: 'decimal', 
    precision: 20, 
    scale: 2, 
    default: 0,
    name: 'daily_withdrawal_total',
    comment: 'Total amount withdrawn today (resets daily)',
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value)
    }
  })
  dailyWithdrawalTotal: number;

  @Column({ 
    type: 'date', 
    nullable: true,
    name: 'last_withdrawal_date',
    comment: 'Date of last withdrawal (for daily limit reset)'
  })
  lastWithdrawalDate: Date | null;

  // For optimistic locking
  @VersionColumn()
  version: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  constructor(id: string, currency: string = 'USD') {
    this.id = id;
    this.balance = 0;
    this.currency = currency;
    this.status = WalletStatus.ACTIVE;
    this.dailyWithdrawalLimit = null;
    this.dailyWithdrawalTotal = 0;
    this.lastWithdrawalDate = null;
    this.version = 0;
  }

  /**
   * Deposit funds into the wallet.
   * @throws {InvalidAmountError} if amount is not positive
   * @throws {WalletNotActiveError} if wallet is not active
   */
  deposit(amount: number): void {
    this.validatePositiveAmount(amount, 'Deposit');
    this.ensureWalletActive();
    this.balance = this.balance + amount;
  }

  /**
   * Withdraw funds from the wallet.
   * Enforces daily withdrawal limits by tracking cumulative withdrawals per day.
   * @throws {InvalidAmountError} if amount is not positive
   * @throws {WalletNotActiveError} if wallet is not active
   * @throws {InsufficientFundsError} if balance is insufficient
   * @throws {WithdrawalLimitExceededError} if cumulative daily withdrawals exceed limit
   */
  withdraw(amount: number): void {
    this.validatePositiveAmount(amount, 'Withdrawal');
    this.ensureWalletActive();
    this.resetDailyLimitIfNewDay();
    this.validateDailyLimit(amount);
    
    if (this.balance < amount) {
      throw new InsufficientFundsError(this.balance, amount);
    }
    
    this.balance = this.balance - amount;
    this.trackWithdrawal(amount);
  }

  /**
   * Credit funds to the wallet (used in transfers).
   * @throws {InvalidAmountError} if amount is not positive
   * @throws {WalletNotActiveError} if wallet is not active
   */
  credit(amount: number): void {
    this.validatePositiveAmount(amount, 'Credit');
    this.ensureWalletActive();
    this.balance = this.balance + amount;
  }

  /**
   * Check if wallet can debit a specific amount.
   * Used for pre-validation before operations.
   */
  canDebit(amount: number): boolean {
    return (
      this.status === WalletStatus.ACTIVE &&
      this.balance >= amount && 
      amount > 0 &&
      (this.dailyWithdrawalLimit === null || amount <= this.dailyWithdrawalLimit)
    );
  }

  /**
   * Freeze the wallet (e.g., for fraud investigation).
   * Frozen wallets cannot perform any operations.
   */
  freeze(): void {
    if (this.status === WalletStatus.CLOSED) {
      throw new WalletClosedError();
    }
    this.status = WalletStatus.FROZEN;
  }

  /**
   * Unfreeze the wallet, returning it to active status.
   */
  unfreeze(): void {
    if (this.status === WalletStatus.FROZEN) {
      this.status = WalletStatus.ACTIVE;
    }
  }

  /**
   * Permanently close the wallet.
   * @throws {NonZeroBalanceError} if wallet has non-zero balance
   */
  close(): void {
    if (this.balance !== 0) {
      throw new NonZeroBalanceError(this.balance);
    }
    this.status = WalletStatus.CLOSED;
  }

  /**
   * Set daily withdrawal limit for risk management.
   */
  setDailyWithdrawalLimit(limit: number | null): void {
    if (limit !== null && limit <= 0) {
      throw new InvalidAmountError(limit, 'Daily withdrawal limit');
    }
    this.dailyWithdrawalLimit = limit;
  }

  /**
   * Check if wallet is active and can perform operations.
   */
  isActive(): boolean {
    return this.status === WalletStatus.ACTIVE;
  }

  private ensureWalletActive(): void {
    if (this.status !== WalletStatus.ACTIVE) {
      throw new WalletNotActiveError(this.status);
    }
  }

  private validatePositiveAmount(amount: number, operation: string): void {
    if (amount <= 0) {
      throw new InvalidAmountError(amount, operation);
    }
  }

  private resetDailyLimitIfNewDay(): void {
    const today = this.getTodayDate();
    let lastDate: string | undefined;

    if (this.lastWithdrawalDate instanceof Date) {
      lastDate = this.lastWithdrawalDate.toISOString().split('T')[0];
    } else if (typeof this.lastWithdrawalDate === 'string') {
      // Handle case where TypeORM returns string for date column
      lastDate = (this.lastWithdrawalDate as string).split('T')[0];
    }
    
    if (lastDate !== today) {
      this.dailyWithdrawalTotal = 0;
    }
  }

  private getTodayDate(): string {
    return new Date().toISOString().split('T')[0];
  }

  private validateDailyLimit(amount: number): void {
    if (this.dailyWithdrawalLimit === null) return;
    
    const totalAfterWithdrawal = this.dailyWithdrawalTotal + amount;
    if (totalAfterWithdrawal > this.dailyWithdrawalLimit) {
      throw new WithdrawalLimitExceededError(
        amount,
        this.dailyWithdrawalLimit
      );
    }
  }

  private trackWithdrawal(amount: number): void {
    this.dailyWithdrawalTotal += amount;
    this.lastWithdrawalDate = new Date();
  }
}
