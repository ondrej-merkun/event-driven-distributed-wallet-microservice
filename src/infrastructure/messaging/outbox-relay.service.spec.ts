import { OutboxRelayService } from './outbox-relay.service';
import { OutboxRepository } from '../repositories/outbox.repository';
import { EventPublisher } from './event-publisher.service';
import { OutboxEvent } from '../../domain/entities/outbox-event.entity';
import { WalletEventType } from '../../modules/wallet/entities/wallet-event.entity';

describe('OutboxRelayService', () => {
  let storedEvents: OutboxEvent[];
  let outboxRepository: Pick<OutboxRepository, 'findUnpublished' | 'markAsPublished'>;
  let eventPublisher: Pick<EventPublisher, 'publish'>;
  let redis: {
    set: jest.Mock;
    del: jest.Mock;
  };
  let firstRelay: OutboxRelayService;
  let secondRelay: OutboxRelayService;

  beforeEach(() => {
    const event = new OutboxEvent('wallet-1', WalletEventType.FUNDS_DEPOSITED, {
      eventType: WalletEventType.FUNDS_DEPOSITED,
      walletId: 'wallet-1',
      amount: 100,
    });
    event.id = 'event-1';
    event.published = false;

    storedEvents = [event];

    outboxRepository = {
      findUnpublished: jest.fn(async () =>
        storedEvents.filter((storedEvent) => !storedEvent.published),
      ),
      markAsPublished: jest.fn(async (ids: string[]) => {
        for (const storedEvent of storedEvents) {
          if (ids.includes(storedEvent.id)) {
            storedEvent.published = true;
          }
        }
      }),
    };

    eventPublisher = {
      publish: jest.fn(async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      }),
    };

    let relayLockHeld = false;
    redis = {
      set: jest.fn(async () => {
        if (relayLockHeld) {
          return null;
        }

        relayLockHeld = true;
        return 'OK';
      }),
      del: jest.fn(async () => {
        relayLockHeld = false;
        return 1;
      }),
    };

    firstRelay = new (OutboxRelayService as any)(
      outboxRepository,
      eventPublisher,
      redis,
    );
    secondRelay = new (OutboxRelayService as any)(
      outboxRepository,
      eventPublisher,
      redis,
    );
  });

  it('serializes relay work across instances so the same event is not published twice', async () => {
    await Promise.all([firstRelay.handleCron(), secondRelay.handleCron()]);

    expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
    expect(outboxRepository.markAsPublished).toHaveBeenCalledWith(['event-1']);
  });
});
