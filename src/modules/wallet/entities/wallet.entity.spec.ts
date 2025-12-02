import { Wallet, WalletStatus } from './wallet.entity';
import {
  InvalidAmountError,
  WalletNotActiveError,
  InsufficientFundsError,
  WithdrawalLimitExceededError,
  WalletClosedError,
  NonZeroBalanceError,
} from '../../../domain/exceptions/wallet.exceptions';

describe('Wallet Entity', () => {
  let wallet: Wallet;

  beforeEach(() => {
    wallet = new Wallet('user-123', 'USD');
  });

  describe('Initialization', () => {
    it('should initialize with zero balance and active status', () => {
      expect(wallet.balance).toBe(0);
      expect(wallet.status).toBe(WalletStatus.ACTIVE);
      expect(wallet.currency).toBe('USD');
      expect(wallet.dailyWithdrawalLimit).toBeNull();
    });
  });

  describe('deposit', () => {
    it('should increase balance', () => {
      wallet.deposit(100);
      expect(wallet.balance).toBe(100);
    });

    it('should throw on negative amount', () => {
      expect(() => wallet.deposit(-10)).toThrow(InvalidAmountError);
    });

    it('should throw on zero amount', () => {
      expect(() => wallet.deposit(0)).toThrow(InvalidAmountError);
    });

    it('should throw if wallet is frozen', () => {
      wallet.freeze();
      expect(() => wallet.deposit(100)).toThrow(WalletNotActiveError);
    });

    it('should throw if wallet is closed', () => {
      wallet.close();
      expect(() => wallet.deposit(100)).toThrow(WalletNotActiveError);
    });
  });

  describe('withdraw', () => {
    beforeEach(() => {
      wallet.deposit(1000);
    });

    it('should decrease balance', () => {
      wallet.withdraw(100);
      expect(wallet.balance).toBe(900);
    });

    it('should throw on insufficient funds', () => {
      expect(() => wallet.withdraw(2000)).toThrow(InsufficientFundsError);
    });

    it('should throw on negative amount', () => {
      expect(() => wallet.withdraw(-10)).toThrow(InvalidAmountError);
    });

    it('should throw if wallet is frozen', () => {
      wallet.freeze();
      expect(() => wallet.withdraw(100)).toThrow(WalletNotActiveError);
    });

    it('should update daily withdrawal total', () => {
      wallet.withdraw(100);
      expect(wallet.dailyWithdrawalTotal).toBe(100);
      wallet.withdraw(50);
      expect(wallet.dailyWithdrawalTotal).toBe(150);
    });

    it('should respect daily limit', () => {
      wallet.setDailyWithdrawalLimit(150);
      wallet.withdraw(100);
      expect(() => wallet.withdraw(60)).toThrow(WithdrawalLimitExceededError);
    });

    it('should reset daily limit on new day', () => {
      wallet.setDailyWithdrawalLimit(150);
      wallet.withdraw(100);
      
      // Mock date to be tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      // We need to hack the private property or use a mockable date provider.
      // Since we can't easily mock `new Date()` inside the class without DI or global mock,
      // we can manually set `lastWithdrawalDate` to yesterday to simulate the condition.
      
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      (wallet as any).lastWithdrawalDate = yesterday;

      // Should not throw, as limit should reset
      wallet.withdraw(100);
      expect(wallet.dailyWithdrawalTotal).toBe(100); // Reset to 0 then +100
    });
  });

  describe('State Transitions', () => {
    it('should freeze and unfreeze', () => {
      wallet.freeze();
      expect(wallet.status).toBe(WalletStatus.FROZEN);
      wallet.unfreeze();
      expect(wallet.status).toBe(WalletStatus.ACTIVE);
    });

    it('should close wallet if balance is zero', () => {
      expect(wallet.balance).toBe(0);
      wallet.close();
      expect(wallet.status).toBe(WalletStatus.CLOSED);
    });

    it('should throw when closing wallet with funds', () => {
      wallet.deposit(10);
      expect(() => wallet.close()).toThrow(NonZeroBalanceError);
    });

    it('should not allow freezing a closed wallet', () => {
      wallet.close();
      expect(() => wallet.freeze()).toThrow(WalletClosedError);
    });
  });
});
