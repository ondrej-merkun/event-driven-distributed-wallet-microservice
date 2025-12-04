import { TransferSaga, TransferSagaState } from './transfer-saga.entity';

describe('TransferSaga Entity', () => {
  let saga: TransferSaga;
  const fromWalletId = 'sender-123';
  const toWalletId = 'receiver-456';
  const amount = 100;
  const currency = 'USD';

  beforeEach(() => {
    saga = new TransferSaga(fromWalletId, toWalletId, amount, currency);
  });

  describe('Initialization', () => {
    it('should initialize with PENDING state', () => {
      expect(saga.state).toBe(TransferSagaState.PENDING);
      expect(saga.fromWalletId).toBe(fromWalletId);
      expect(saga.toWalletId).toBe(toWalletId);
      expect(saga.amount).toBe(amount);
      expect(saga.currency).toBe(currency);
      expect(saga.metadata).toBeNull();
    });
  });

  describe('State Transitions', () => {
    describe('markAsDebited', () => {
      it('should transition from PENDING to DEBITED', () => {
        saga.markAsDebited();
        expect(saga.state).toBe(TransferSagaState.DEBITED);
      });

      it('should throw if not in PENDING state', () => {
        saga.markAsDebited(); // Now DEBITED
        expect(() => saga.markAsDebited()).toThrow(/Cannot mark as debited/);
      });
    });

    describe('markAsCompleted', () => {
      it('should transition from DEBITED to COMPLETED', () => {
        saga.markAsDebited();
        saga.markAsCompleted();
        expect(saga.state).toBe(TransferSagaState.COMPLETED);
      });

      it('should throw if not in DEBITED state', () => {
        expect(() => saga.markAsCompleted()).toThrow(/Cannot mark as completed/);
      });
    });

    describe('markAsCompensated', () => {
      it('should transition from DEBITED to COMPENSATED', () => {
        saga.markAsDebited();
        const reason = 'Receiver wallet full';
        saga.markAsCompensated(reason);
        expect(saga.state).toBe(TransferSagaState.COMPENSATED);
        expect(saga.metadata).toEqual({ compensationReason: reason });
      });

      it('should throw if not in DEBITED state', () => {
        expect(() => saga.markAsCompensated('reason')).toThrow(/Cannot compensate/);
      });
    });

    describe('markAsFailed', () => {
      it('should transition to FAILED from PENDING', () => {
        const reason = 'Validation error';
        saga.markAsFailed(reason);
        expect(saga.state).toBe(TransferSagaState.FAILED);
        expect(saga.metadata).toEqual({ failureReason: reason });
      });

      it('should transition to FAILED from DEBITED', () => {
        saga.markAsDebited();
        const reason = 'Network error';
        saga.markAsFailed(reason);
        expect(saga.state).toBe(TransferSagaState.FAILED);
        expect(saga.metadata).toEqual({ failureReason: reason });
      });
    });
  });
});
