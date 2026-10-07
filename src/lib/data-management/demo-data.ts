import type { BackupRecord } from './backup';
import { withDataLock } from './data-lock';
import { RestoreError } from './restore-errors';
import {
  getDataManagementPaths,
  recoverPendingRestoresUnlocked,
} from './restore-recovery';
import {
  replaceStoreSetUnlocked,
  type CompleteStoreSet,
  type StoreReplacementTestHooks,
} from './store-replacement';
import { readCompleteStoreSet, validateCompleteStoreSet } from './store-state';

export type DemoDataSeedOptions = {
  dataDirectory?: string;
  operationsDirectory?: string;
  now?: () => Date;
  random?: () => number;
  hooks?: StoreReplacementTestHooks;
};

export type DemoDataSeedResult = {
  ok: true;
  accounts: number;
  transactions: number;
  cleanupWarning?: string;
};

const demoId = (workspaceId: string, kind: 'account' | 'transaction', suffix: string) =>
  `demo_${kind}_${workspaceId}_${suffix}`;

const randomAmount = (random: () => number, min: number, max: number) =>
  Number((random() * (max - min) + min).toFixed(2));

const buildDemoRecords = (
  workspaceId: string,
  timestamp: string,
  random: () => number
) => {
  const accountIds = {
    checking: demoId(workspaceId, 'account', 'checking'),
    savings: demoId(workspaceId, 'account', 'savings'),
    card: demoId(workspaceId, 'account', 'card'),
  };
  const transactionId = (suffix: string) => demoId(workspaceId, 'transaction', suffix);
  const daysAgo = (days: number) => {
    const date = new Date(timestamp);
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString();
  };

  const accounts: BackupRecord[] = [
    { id: accountIds.checking, workspaceId, name: 'Household Checking', type: 'bank', currency: 'EUR', institution: 'Main Bank', openingBalance: 1500, archived: false, createdAt: timestamp, updatedAt: timestamp },
    { id: accountIds.savings, workspaceId, name: 'Personal Savings', type: 'bank', currency: 'EUR', institution: 'Savings Bank', openingBalance: 5000, archived: false, createdAt: timestamp, updatedAt: timestamp },
    { id: accountIds.card, workspaceId, name: 'Groceries Card', type: 'credit_card', currency: 'EUR', institution: 'Credit Bank', openingBalance: 0, archived: false, createdAt: timestamp, updatedAt: timestamp },
  ];

  const transaction = (
    suffix: string,
    accountId: string,
    days: number,
    description: string,
    rawDescription: string,
    amount: number,
    type: 'Expense' | 'Income'
  ): BackupRecord => ({
    id: transactionId(suffix),
    workspaceId,
    accountId,
    date: daysAgo(days),
    description,
    rawDescription,
    amountOriginal: amount,
    currencyOriginal: 'EUR',
    amountBase: amount,
    type,
    needsReview: true,
    isInternalTransfer: false,
    isPotentialDuplicate: false,
    isInconsistent: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const groceriesOne = -randomAmount(random, 80, 120);
  const groceriesTwo = -randomAmount(random, 70, 110);
  const dinner = -randomAmount(random, 50, 90);
  const train = -randomAmount(random, 30, 50);
  const shopping = -randomAmount(random, 20, 60);
  const transferOutId = transactionId('transfer-out');
  const transferInId = transactionId('transfer-in');

  const transactions: BackupRecord[] = [
    transaction('rent', accountIds.checking, 2, 'Monthly Rent', 'RENT PAYMENT', -1200, 'Expense'),
    transaction('salary-current', accountIds.checking, 5, 'Salary Deposit', 'SALARY TRANSFER', 3500, 'Income'),
    transaction('groceries-current', accountIds.card, 7, 'Weekly Groceries', 'SUPERMARKET XYZ', groceriesOne, 'Expense'),
    transaction('groceries-previous', accountIds.card, 10, 'Groceries', 'MERCADONA', groceriesTwo, 'Expense'),
    transaction('dinner', accountIds.checking, 12, 'Dinner with Family', 'RESTAURANTE LISBOA', dinner, 'Expense'),
    transaction('music', accountIds.checking, 15, 'Spotify', 'SPOTIFY AB', -9.99, 'Expense'),
    transaction('train', accountIds.checking, 18, 'Train ticket', 'CP COMBOIOS', train, 'Expense'),
    transaction('shopping', accountIds.card, 20, 'Amazon Purchase', 'AMAZON EU', shopping, 'Expense'),
    transaction('salary-previous', accountIds.checking, 32, 'Salary Deposit', 'SALARY TRANSFER', 3500, 'Income'),
    transaction('streaming', accountIds.checking, 35, 'Netflix', 'NETFLIX.COM', -15.99, 'Expense'),
    {
      id: transferOutId,
      workspaceId,
      accountId: accountIds.savings,
      destinationAccountId: accountIds.checking,
      linkedTransactionId: transferInId,
      internalDirection: 'Out',
      date: daysAgo(38),
      description: 'Transfer to Checking',
      rawDescription: 'TRANSFER TO CHECK',
      amountOriginal: -500,
      currencyOriginal: 'EUR',
      amountBase: -500,
      type: 'InternalTransfer',
      needsReview: true,
      isInternalTransfer: true,
      isPotentialDuplicate: false,
      isInconsistent: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: transferInId,
      workspaceId,
      accountId: accountIds.checking,
      destinationAccountId: accountIds.savings,
      linkedTransactionId: transferOutId,
      internalDirection: 'In',
      date: daysAgo(38),
      description: 'Transfer from Savings',
      rawDescription: 'TRANSFER FROM SAV',
      amountOriginal: 500,
      currencyOriginal: 'EUR',
      amountBase: 500,
      type: 'InternalTransfer',
      needsReview: true,
      isInternalTransfer: true,
      isPotentialDuplicate: false,
      isInconsistent: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];

  return { accounts, transactions };
};

export const seedDemoData = async (
  workspaceId: string,
  clear = false,
  options: DemoDataSeedOptions = {}
): Promise<DemoDataSeedResult> => withDataLock(() => {
  recoverPendingRestoresUnlocked(options);
  const current = readCompleteStoreSet(options.dataDirectory);
  if (!current.workspaces.some((workspace) => workspace.id === workspaceId)) {
    throw new RestoreError('INVALID_OPERATION', 'Workspace not found.');
  }

  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const demo = buildDemoRecords(workspaceId, timestamp, options.random ?? Math.random);
  const demoAccountIds = new Set(demo.accounts.map((record) => record.id));
  const demoTransactionIds = new Set(demo.transactions.map((record) => record.id));
  const resulting = structuredClone(current) as CompleteStoreSet;

  resulting.accounts = resulting.accounts.filter((record) => clear
    ? record.workspaceId !== workspaceId
    : !demoAccountIds.has(record.id));
  resulting.transactions = resulting.transactions.filter((record) => clear
    ? record.workspaceId !== workspaceId
    : !demoTransactionIds.has(record.id));
  resulting.accounts.push(...demo.accounts);
  resulting.transactions.push(...demo.transactions);

  validateCompleteStoreSet(resulting);

  const replacement = replaceStoreSetUnlocked(
    resulting,
    getDataManagementPaths(options),
    {
      operationKind: 'demo-data-seed',
      targetStores: ['accounts', 'transactions'],
      now: options.now,
      hooks: options.hooks,
      executionFailureCode: 'DATA_OPERATION_FAILURE',
      preparationFailureMessage: 'Demo data could not be prepared. Current data was not changed.',
      rollbackSuccessMessage: 'Demo data could not be loaded. Original data was restored successfully.',
      cleanupWarningMessage: 'Demo data was loaded, but temporary recovery files could not be fully removed.',
    }
  );

  return {
    ok: true,
    accounts: demo.accounts.length,
    transactions: demo.transactions.length,
    cleanupWarning: replacement.cleanupWarning,
  };
});
