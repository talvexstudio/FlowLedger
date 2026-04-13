// Duplicate transaction detection — safe to import server-side only (used in API routes).

import type { Transaction } from '@/lib/types';
import { descriptionSimilarity } from './rule-utils';

const DAY_MS = 24 * 60 * 60 * 1000;

export type DuplicateMatch = {
  existingTransaction: Transaction;
  matchScore: number;
  reasons: string[];
  matchType: 'duplicate' | 'potential_transfer';
};

export type PotentialTransfer = {
  transaction1: Transaction;
  transaction2: Transaction;
  matchScore: number;
};

/**
 * Find potential duplicates for a new transaction among existing ones.
 * Considers same account, amount within ±0.01, and description similarity >= threshold,
 * all within a configurable day window.
 */
export function findDuplicateTransactions(
  newTx: Partial<Transaction>,
  existingTransactions: Transaction[],
  options: { dayWindowSize?: number; descriptionSimilarityThreshold?: number } = {}
): DuplicateMatch[] {
  const { dayWindowSize = 3, descriptionSimilarityThreshold = 0.75 } = options;

  if (!newTx.accountId || !newTx.date || typeof newTx.amountBase !== 'number') {
    return [];
  }

  const newDate = new Date(newTx.date).getTime();
  const newDesc = newTx.rawDescription || newTx.description || '';
  const newAmount = newTx.amountBase;

  const matches: DuplicateMatch[] = [];

  for (const existing of existingTransactions) {
    const reasons: string[] = [];

    // Must be same account
    if (existing.accountId !== newTx.accountId) continue;
    reasons.push('same_account');

    // Must be within day window
    const existingDate = new Date(existing.date).getTime();
    const dayDiff = Math.abs(newDate - existingDate) / DAY_MS;
    if (dayDiff > dayWindowSize) continue;

    // Amount must be within ±0.01
    if (Math.abs(existing.amountBase - newAmount) > 0.01) continue;
    reasons.push('same_amount');

    // Description similarity check
    const existingDesc = existing.rawDescription || existing.description || '';
    const similarity = descriptionSimilarity(newDesc, existingDesc);
    if (similarity < descriptionSimilarityThreshold) continue;
    reasons.push('similar_description');

    const matchScore =
      similarity * 0.6 +
      (1 - dayDiff / dayWindowSize) * 0.4;

    matches.push({ existingTransaction: existing, matchScore, reasons, matchType: 'duplicate' });
  }

  return matches.sort((a, b) => b.matchScore - a.matchScore);
}

/**
 * Find potential inter-account transfers for a transaction.
 * Looks for opposite-signed amounts in different accounts within the same day.
 * These are likely unlinked transfer pairs that should be marked as internal transfers.
 */
export function findPotentialTransfers(
  newTx: Partial<Transaction>,
  existingTransactions: Transaction[]
): DuplicateMatch[] {
  if (!newTx.accountId || !newTx.date || typeof newTx.amountBase !== 'number') {
    return [];
  }

  const newDate = new Date(newTx.date).getTime();
  const newAmount = newTx.amountBase;
  const matches: DuplicateMatch[] = [];

  for (const existing of existingTransactions) {
    // Must be different account
    if (existing.accountId === newTx.accountId) continue;

    // Must be same day (not 3 day window)
    const existingDate = new Date(existing.date).getTime();
    const dayDiff = Math.abs(newDate - existingDate) / DAY_MS;
    if (dayDiff > 1) continue;

    // Must be opposite-signed amounts (within ±0.01 tolerance)
    // e.g., -100 in account A and +100 in account B
    const amountDiff = Math.abs(Math.abs(existing.amountBase) - Math.abs(newAmount));
    if (amountDiff > 0.01) continue;

    if ((existing.amountBase > 0 && newAmount > 0) || (existing.amountBase < 0 && newAmount < 0)) {
      continue;
    }

    const matchScore = 1 - (dayDiff / 1); // Perfect score for same day, decreases over time

    matches.push({
      existingTransaction: existing,
      matchScore,
      reasons: ['opposite_amounts', 'different_accounts', 'same_day'],
      matchType: 'potential_transfer'
    });
  }

  return matches.sort((a, b) => b.matchScore - a.matchScore);
}
