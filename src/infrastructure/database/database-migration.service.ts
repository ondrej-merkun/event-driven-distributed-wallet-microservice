import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Service that installs database triggers for event immutability.
 * 
 * This runs after TypeORM creates the wallet_events table, ensuring
 * the triggers can be attached to an existing table.
 */
@Injectable()
export class DatabaseMigrationService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseMigrationService.name);

  constructor(private dataSource: DataSource) {}

  async onModuleInit() {
    await this.installEventImmutabilityTriggers();
  }

  private async installEventImmutabilityTriggers() {
    try {
      this.logger.log('Installing event immutability triggers...');

      await this.dataSource.query(`
        CREATE OR REPLACE FUNCTION prevent_wallet_event_modification()
        RETURNS TRIGGER AS $$
        BEGIN
          RAISE EXCEPTION 'wallet_events table is immutable. % operations are not allowed. Events form a permanent audit trail and cannot be modified or deleted after creation.',
            TG_OP
            USING ERRCODE = '23506';
        END;
        $$ LANGUAGE plpgsql;
      `);

      // Drop triggers if they exist (idempotent)
      await this.dataSource.query(`
        DROP TRIGGER IF EXISTS prevent_wallet_event_update ON wallet_events;
      `);

      await this.dataSource.query(`
        DROP TRIGGER IF EXISTS prevent_wallet_event_delete ON wallet_events;
      `);

      // Create triggers
      await this.dataSource.query(`
        CREATE TRIGGER prevent_wallet_event_update
          BEFORE UPDATE ON wallet_events
          FOR EACH ROW
          EXECUTE FUNCTION prevent_wallet_event_modification();
      `);

      await this.dataSource.query(`
        CREATE TRIGGER prevent_wallet_event_delete
          BEFORE DELETE ON wallet_events
          FOR EACH ROW
          EXECUTE FUNCTION prevent_wallet_event_modification();
      `);

      this.logger.log('✅ Event immutability triggers installed successfully');
    } catch (error) {
      this.logger.error('Failed to install event immutability triggers', error);
      throw error;
    }
  }
}
