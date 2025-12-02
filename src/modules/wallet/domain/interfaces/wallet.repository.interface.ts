import { Wallet } from '../../entities/wallet.entity';
import { WalletEventType } from '../../entities/wallet-event.entity';
import { EntityManager } from 'typeorm';

export interface IWalletRepository {
  findById(id: string): Promise<Wallet | null>;
  findByIdWithLock(id: string, manager: EntityManager): Promise<Wallet | null>;
  getOrCreate(id: string, currency: string, manager: EntityManager): Promise<Wallet>;
  save(wallet: Wallet, manager?: EntityManager): Promise<Wallet>;
  saveWithEvent(
    wallet: Wallet,
    eventType: WalletEventType,
    amount?: number,
    metadata?: Record<string, any>,
    manager?: EntityManager,
  ): Promise<Wallet>;
  getEventHistory(
    walletId: string,
    limit: number,
    offset: number,
  ): Promise<any[]>;
}
