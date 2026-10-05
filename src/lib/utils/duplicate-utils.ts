// Duplicate transaction detection — safe to import server-side only (used in API routes).

import type { PotentialDuplicateMatchContext, Transaction } from '@/lib/types';

const DAY_MS = 24 * 60 * 60 * 1000;

export type DuplicateMatch = {
  existingTransaction: Transaction;
  matchScore: number;
  reasons: string[];
  matchType: 'duplicate' | 'potential_transfer';
  calendarDayDifference?: number;
};

export type PotentialTransferOptions = {
  workspaceId?: string;
  counterpartAccountId?: string;
  sourceTransactionId?: string;
  excludeLinked?: boolean;
  maxCalendarDayDifference?: number;
};

export type PotentialTransfer = {
  transaction1: Transaction;
  transaction2: Transaction;
  matchScore: number;
};

export const toPotentialDuplicateMatchContext = (
  match: DuplicateMatch
): PotentialDuplicateMatchContext => ({
  transactionId: match.existingTransaction.id,
  date: match.existingTransaction.date,
  description: match.existingTransaction.description,
  amountBase: match.existingTransaction.amountBase,
});

export const getDuplicateApprovalBlockReason = (
  current: Partial<Transaction>,
  update?: Partial<Transaction>
) => current.isPotentialDuplicate && update?.isPotentialDuplicate !== false
  ? 'Potential duplicate: open Edit and explicitly keep this transaction.'
  : null;

const normalizeTextIdentity = (value?: string) =>
  value?.trim().replace(/\s+/g, ' ').toLocaleLowerCase() || '';

const getTextIdentities = (transaction: Partial<Transaction>) =>
  new Set(
    [transaction.description, transaction.rawDescription]
      .map(normalizeTextIdentity)
      .filter(Boolean)
  );

const getCalendarDateKey = (value: Date | string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-');
};

const normalizeAmountToCents = (amount: number) => Math.round(amount * 100);

const getCalendarDayNumber = (value: Date | string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
};

/**
 * Find potential duplicates for a new transaction among existing ones.
 * Requires the same workspace/account, calendar date, normalized cent amount,
 * and an exact normalized identity match across description/rawDescription.
 */
export function findDuplicateTransactions(
  newTx: Partial<Transaction>,
  existingTransactions: Transaction[]
): DuplicateMatch[] {
  if (!newTx.accountId || !newTx.date || typeof newTx.amountBase !== 'number') {
    return [];
  }

  const newDateKey = getCalendarDateKey(newTx.date);
  const newIdentities = getTextIdentities(newTx);
  const newAmount = normalizeAmountToCents(newTx.amountBase);
  if (!newDateKey || newIdentities.size === 0) return [];

  const matches: DuplicateMatch[] = [];

  for (const existing of existingTransactions) {
    const reasons: string[] = [];

    if (newTx.workspaceId && existing.workspaceId !== newTx.workspaceId) continue;

    // Must be same account
    if (existing.accountId !== newTx.accountId) continue;
    reasons.push('same_account');

    // Must be the same displayed calendar date
    if (getCalendarDateKey(existing.date) !== newDateKey) continue;
    reasons.push('same_calendar_date');

    // Amount must resolve to the same currency cent
    if (normalizeAmountToCents(existing.amountBase) !== newAmount) continue;
    reasons.push('same_amount');

    const existingIdentities = getTextIdentities(existing);
    const matchingIdentity = [...newIdentities].find((identity) => existingIdentities.has(identity));
    if (!matchingIdentity) continue;
    reasons.push('matching_text_identity');

    matches.push({ existingTransaction: existing, matchScore: 1, reasons, matchType: 'duplicate' });
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
  existingTransactions: Transaction[],
  options: PotentialTransferOptions = {}
): DuplicateMatch[] {
  if (!newTx.accountId || !newTx.date || typeof newTx.amountBase !== 'number') {
    return [];
  }

  const newDate = getCalendarDayNumber(newTx.date);
  const newAmount = normalizeAmountToCents(newTx.amountBase);
  const maxCalendarDayDifference = options.maxCalendarDayDifference ?? 1;
  if (newDate === null || newAmount === 0) return [];
  const matches: DuplicateMatch[] = [];

  for (const existing of existingTransactions) {
    if (options.sourceTransactionId && existing.id === options.sourceTransactionId) continue;
    if (options.workspaceId && existing.workspaceId !== options.workspaceId) continue;
    if (options.counterpartAccountId && existing.accountId !== options.counterpartAccountId) continue;
    if (options.excludeLinked && existing.linkedTransactionId) continue;

    // Must be different account
    if (existing.accountId === newTx.accountId) continue;

    const existingDate = getCalendarDayNumber(existing.date);
    if (existingDate === null) continue;
    const dayDiff = Math.abs(newDate - existingDate);
    if (dayDiff > maxCalendarDayDifference) continue;

    const existingAmount = normalizeAmountToCents(existing.amountBase);
    if (existingAmount === 0 || Math.abs(existingAmount) !== Math.abs(newAmount)) continue;

    if (Math.sign(existingAmount) === Math.sign(newAmount)) continue;

    const matchScore = dayDiff === 0 ? 1 : 0;

    matches.push({
      existingTransaction: existing,
      matchScore,
      reasons: ['opposite_amounts', 'different_accounts', dayDiff === 0 ? 'same_day' : 'within_one_day'],
      matchType: 'potential_transfer',
      calendarDayDifference: dayDiff,
    });
  }

  return matches.sort((a, b) =>
    (a.calendarDayDifference ?? 0) - (b.calendarDayDifference ?? 0) ||
    a.existingTransaction.id.localeCompare(b.existingTransaction.id)
  );
}
