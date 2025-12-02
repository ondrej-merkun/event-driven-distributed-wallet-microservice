import { Wallet } from './wallet.entity';
import * as fc from 'fast-check';
import {
  WithdrawalLimitExceededError,
} from '../../../domain/exceptions/wallet.exceptions';

describe('Wallet Entity Properties', () => {
  
  it('should never have a negative balance (Invariant)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            type: fc.constantFrom('deposit', 'withdraw'),
            amount: fc.double({ min: 0.01, max: 1000000, noNaN: true })
          }),
          { minLength: 1, maxLength: 50 }
        ),
        (operations) => {
          const wallet = new Wallet('prop-test-1');
          
          for (const op of operations) {
            try {
              if (op.type === 'deposit') {
                wallet.deposit(op.amount);
              } else {
                wallet.withdraw(op.amount);
              }
            } catch (e) {
              // Ignore expected errors (insufficient funds, etc.)
              // We only care that IF the operation succeeded, the invariant holds
            }
            
            // INVARIANT: Balance >= 0
            if (wallet.balance < 0) {
              return false;
            }
          }
          return true;
        }
      )
    );
  });

  it('deposit(a) + withdraw(a) should return to original balance', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 1000000, noNaN: true }), // Initial balance
        fc.double({ min: 0.01, max: 1000000, noNaN: true }), // Amount
        (initial, amount) => {
          const wallet = new Wallet('prop-test-2');
          wallet.deposit(initial);
          const balanceAfterDeposit = wallet.balance;
          
          // Precondition: wallet has enough funds (guaranteed by deposit)
          
          wallet.deposit(amount);
          wallet.withdraw(amount);
          
          // Floating point comparison with epsilon
          return Math.abs(wallet.balance - balanceAfterDeposit) < 1e-9;
        }
      )
    );
  });

  it('should never exceed daily limit', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 100, max: 1000, noNaN: true }), // Limit
        fc.array(fc.double({ min: 1, max: 100, noNaN: true }), { minLength: 1, maxLength: 20 }), // Withdrawals
        (limit, withdrawals) => {
          const wallet = new Wallet('prop-test-3');
          wallet.deposit(1000000); // Infinite money
          wallet.setDailyWithdrawalLimit(limit);
          
          let totalWithdrawn = 0;
          
          for (const amount of withdrawals) {
            try {
              wallet.withdraw(amount);
              totalWithdrawn += amount;
            } catch (e) {
              if (e instanceof WithdrawalLimitExceededError) {
                // Expected if limit reached
              } else {
                throw e; // Unexpected error
              }
            }
          }
          
          // INVARIANT: Total withdrawn <= Limit (plus epsilon for float precision)
          return totalWithdrawn <= limit + 1e-9;
        }
      )
    );
  });
});
