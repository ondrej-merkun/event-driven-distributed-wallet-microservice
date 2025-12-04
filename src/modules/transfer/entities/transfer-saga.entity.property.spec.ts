import { TransferSaga, TransferSagaState } from './transfer-saga.entity';
import * as fc from 'fast-check';

describe('TransferSaga Entity Properties', () => {
  
  it('should respect state transition rules', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom('markAsDebited', 'markAsCompleted', 'markAsCompensated', 'markAsFailed'),
          { minLength: 1, maxLength: 20 }
        ),
        (operations) => {
          const saga = new TransferSaga('sender', 'receiver', 100, 'USD');
          
          for (const op of operations) {
            const previousState = saga.state;
            
            try {
              switch (op) {
                case 'markAsDebited':
                  saga.markAsDebited();
                  break;
                case 'markAsCompleted':
                  saga.markAsCompleted();
                  break;
                case 'markAsCompensated':
                  saga.markAsCompensated('reason');
                  break;
                case 'markAsFailed':
                  saga.markAsFailed('reason');
                  break;
              }
            } catch (e) {
              // If it throws, state must not change
              if (saga.state !== previousState) return false;
              continue;
            }

            // If it succeeded, verify the transition was valid
            if (op === 'markAsDebited') {
              if (previousState !== TransferSagaState.PENDING) return false;
              if (saga.state !== TransferSagaState.DEBITED) return false;
            }
            if (op === 'markAsCompleted') {
              if (previousState !== TransferSagaState.DEBITED) return false;
              if (saga.state !== TransferSagaState.COMPLETED) return false;
            }
            if (op === 'markAsCompensated') {
              if (previousState !== TransferSagaState.DEBITED) return false;
              if (saga.state !== TransferSagaState.COMPENSATED) return false;
            }
            if (op === 'markAsFailed') {
              if (saga.state !== TransferSagaState.FAILED) return false;
            }
          }
          return true;
        }
      )
    );
  });

  it('should never be in an undefined state', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom('markAsDebited', 'markAsCompleted', 'markAsCompensated', 'markAsFailed'),
          { minLength: 1, maxLength: 20 }
        ),
        (operations) => {
          const saga = new TransferSaga('sender', 'receiver', 100, 'USD');
          
          for (const op of operations) {
            try {
              if (op === 'markAsDebited') saga.markAsDebited();
              if (op === 'markAsCompleted') saga.markAsCompleted();
              if (op === 'markAsCompensated') saga.markAsCompensated('reason');
              if (op === 'markAsFailed') saga.markAsFailed('reason');
            } catch (e) {}
          }

          return Object.values(TransferSagaState).includes(saga.state);
        }
      )
    );
  });
});
