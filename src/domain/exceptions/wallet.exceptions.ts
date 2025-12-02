/**
 * Wallet entity exceptions.
 * 
 * These exceptions are thrown by the Wallet entity when business rules
 * or invariants are violated during wallet operations.
 */

import { DomainException } from './domain.exception';

export class InsufficientFundsError extends DomainException {
  constructor(
    public readonly currentBalance: number,
    public readonly requestedAmount: number
  ) {
    super(
      `Insufficient funds: balance=${currentBalance.toFixed(2)}, requested=${requestedAmount.toFixed(2)}`
    );
  }
}

export class WalletNotActiveError extends DomainException {
  constructor(public readonly currentStatus: string) {
    super(`Wallet is not active. Current status: ${currentStatus}`);
  }
}

export class WithdrawalLimitExceededError extends DomainException {
  constructor(
    public readonly requestedAmount: number,
    public readonly dailyLimit: number
  ) {
    super(
      `Withdrawal limit exceeded: requested=${requestedAmount.toFixed(2)}, daily limit=${dailyLimit.toFixed(2)}`
    );
  }
}

export class InvalidAmountError extends DomainException {
  constructor(
    public readonly amount: number,
    public readonly operation: string
  ) {
    super(`${operation} amount must be positive, got: ${amount}`);
  }
}

export class WalletClosedError extends DomainException {
  constructor() {
    super('Cannot perform operations on a closed wallet');
  }
}

export class NonZeroBalanceError extends DomainException {
  constructor(public readonly balance: number) {
    super(`Cannot close wallet with non-zero balance: ${balance.toFixed(2)}`);
  }
}
