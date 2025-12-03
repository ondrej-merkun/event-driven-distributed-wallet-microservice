import { EntitySubscriberInterface, EventSubscriber, UpdateEvent, RemoveEvent } from 'typeorm';
import { WalletEvent } from '../../modules/wallet/entities/wallet-event.entity';

/**
 * WalletEventSubscriber enforces immutability of wallet events at the ORM level.
 * 
 * This subscriber intercepts any attempt to UPDATE or DELETE wallet events
 * and throws an error, ensuring events remain immutable after creation.
 * 
 * This is a defense-in-depth measure alongside:
 * - Repository pattern (only exposes insert operations)
 * - Application conventions (no update/delete code paths)
 */
@EventSubscriber()
export class WalletEventSubscriber implements EntitySubscriberInterface<WalletEvent> {
  /**
   * Indicates that this subscriber only listens to WalletEvent entity.
   */
  listenTo() {
    return WalletEvent;
  }

  /**
   * Called before UPDATE operations.
   * Throws error to prevent any modifications to existing events.
   */
  beforeUpdate(_event: UpdateEvent<WalletEvent>) {
    throw new Error(
      'WalletEvent is immutable. Updates are not allowed. ' +
      'Events form a permanent audit trail and cannot be modified after creation.'
    );
  }

  /**
   * Called before DELETE operations.
   * Throws error to prevent deletion of events.
   */
  beforeRemove(_event: RemoveEvent<WalletEvent>) {
    throw new Error(
      'WalletEvent is immutable. Deletions are not allowed. ' +
      'Events form a permanent audit trail and cannot be deleted.'
    );
  }
}
