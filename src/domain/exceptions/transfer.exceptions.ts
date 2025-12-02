/**
 * Transfer operation exceptions.
 * 
 * These exceptions are thrown by transfer services when transfer-specific
 * business rules are violated (e.g., currency mismatch, transfer limits).
 */

import { DomainException } from './domain.exception';

export class CurrencyMismatchError extends DomainException {
  constructor(
    public readonly fromCurrency: string,
    public readonly toCurrency: string,
    public readonly fromWalletId: string,
    public readonly toWalletId: string,
  ) {
    super(
      `Currency mismatch: Cannot transfer from ${fromCurrency} wallet (${fromWalletId}) to ${toCurrency} wallet (${toWalletId}). ` +
      `Cross-currency transfers are not supported.`
    );
  }
}
