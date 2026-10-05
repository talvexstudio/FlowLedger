import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/services/firestore';
import type { Account, Transaction } from '@/lib/types';

const now = () => new Date().toISOString();
const rand = (min: number, max: number) =>
  parseFloat((Math.random() * (max - min) + min).toFixed(2));

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
};

const DEMO_ACCOUNTS: Omit<Account, 'workspaceId' | 'createdAt' | 'updatedAt'>[] = [
  { id: 'acc1', name: 'Household Checking', type: 'bank', currency: 'EUR', institution: 'Main Bank', openingBalance: 1500, archived: false },
  { id: 'acc2', name: 'Personal Savings', type: 'bank', currency: 'EUR', institution: 'Savings Bank', openingBalance: 5000, archived: false },
  { id: 'acc3', name: 'Groceries Card', type: 'credit_card', currency: 'EUR', institution: 'Credit Bank', openingBalance: 0, archived: false },
];

const buildDemoTransactions = (): Omit<Transaction, 'workspaceId' | 'createdAt' | 'updatedAt'>[] => [
  { id: 'txn_d1', accountId: 'acc1', date: daysAgo(2) as any, description: 'Monthly Rent', rawDescription: 'RENT PAYMENT', amountOriginal: -1200, currencyOriginal: 'EUR', amountBase: -1200, type: 'Expense', categoryId: 'cat_housing', subcategoryId: 'sub_rent', needsReview: false, isInternalTransfer: false, isPotentialDuplicate: false, isInconsistent: false },
  { id: 'txn_d2', accountId: 'acc1', date: daysAgo(5) as any, description: 'Salary Deposit', rawDescription: 'SALARY TRANSFER', amountOriginal: 3500, currencyOriginal: 'EUR', amountBase: 3500, type: 'Income', categoryId: 'cat_income', subcategoryId: 'sub_salary', needsReview: false, isInternalTransfer: false, isPotentialDuplicate: false, isInconsistent: false },
  { id: 'txn_d3', accountId: 'acc3', date: daysAgo(7) as any, description: 'Weekly Groceries', rawDescription: 'SUPERMARKET XYZ', amountOriginal: -rand(80, 120), currencyOriginal: 'EUR', amountBase: -rand(80, 120), type: 'Expense', categoryId: 'cat_groceries', subcategoryId: 'sub_supermarket', needsReview: true, isInternalTransfer: false, isPotentialDuplicate: false, isInconsistent: false },
  { id: 'txn_d4', accountId: 'acc3', date: daysAgo(10) as any, description: 'Groceries', rawDescription: 'MERCADONA', amountOriginal: -rand(70, 110), currencyOriginal: 'EUR', amountBase: -rand(70, 110), type: 'Expense', categoryId: 'cat_groceries', subcategoryId: 'sub_supermarket', needsReview: false, isInternalTransfer: false, isPotentialDuplicate: false, isInconsistent: false },
  { id: 'txn_d5', accountId: 'acc1', date: daysAgo(12) as any, description: 'Dinner with Family', rawDescription: 'RESTAURANTE LISBOA', amountOriginal: -rand(50, 90), currencyOriginal: 'EUR', amountBase: -rand(50, 90), type: 'Expense', categoryId: 'cat_restaurants', subcategoryId: 'sub_restaurants', needsReview: true, isInternalTransfer: false, isPotentialDuplicate: false, isInconsistent: false },
  { id: 'txn_d6', accountId: 'acc1', date: daysAgo(15) as any, description: 'Spotify', rawDescription: 'SPOTIFY AB', amountOriginal: -9.99, currencyOriginal: 'EUR', amountBase: -9.99, type: 'Expense', categoryId: 'cat_subscriptions', subcategoryId: 'sub_music', needsReview: false, isInternalTransfer: false, isPotentialDuplicate: false, isInconsistent: false },
  { id: 'txn_d7', accountId: 'acc1', date: daysAgo(18) as any, description: 'Train ticket', rawDescription: 'CP COMBOIOS', amountOriginal: -rand(30, 50), currencyOriginal: 'EUR', amountBase: -rand(30, 50), type: 'Expense', categoryId: 'cat_transport', subcategoryId: 'sub_public_transport', needsReview: false, isInternalTransfer: false, isPotentialDuplicate: false, isInconsistent: false },
  { id: 'txn_d8', accountId: 'acc3', date: daysAgo(20) as any, description: 'Amazon Purchase', rawDescription: 'AMAZON EU', amountOriginal: -rand(20, 60), currencyOriginal: 'EUR', amountBase: -rand(20, 60), type: 'Expense', categoryId: 'cat_shopping', subcategoryId: 'sub_home_diy', needsReview: true, isInternalTransfer: false, isPotentialDuplicate: false, isInconsistent: false },
  { id: 'txn_d9', accountId: 'acc1', date: daysAgo(32) as any, description: 'Salary Deposit', rawDescription: 'SALARY TRANSFER', amountOriginal: 3500, currencyOriginal: 'EUR', amountBase: 3500, type: 'Income', categoryId: 'cat_income', subcategoryId: 'sub_salary', needsReview: false, isInternalTransfer: false, isPotentialDuplicate: false, isInconsistent: false },
  { id: 'txn_d10', accountId: 'acc1', date: daysAgo(35) as any, description: 'Netflix', rawDescription: 'NETFLIX.COM', amountOriginal: -15.99, currencyOriginal: 'EUR', amountBase: -15.99, type: 'Expense', categoryId: 'cat_subscriptions', subcategoryId: 'sub_streaming', needsReview: false, isInternalTransfer: false, isPotentialDuplicate: false, isInconsistent: false },
  { id: 'txn_d11', accountId: 'acc2', date: daysAgo(38) as any, description: 'Transfer to Checking', rawDescription: 'TRANSFER TO CHECK', amountOriginal: -500, currencyOriginal: 'EUR', amountBase: -500, type: 'InternalTransfer', categoryId: 'cat_transfers', subcategoryId: 'sub_transfers', needsReview: false, isInternalTransfer: true, isPotentialDuplicate: false, isInconsistent: false },
  { id: 'txn_d12', accountId: 'acc1', date: daysAgo(38) as any, description: 'Transfer from Savings', rawDescription: 'TRANSFER FROM SAV', amountOriginal: 500, currencyOriginal: 'EUR', amountBase: 500, type: 'InternalTransfer', categoryId: 'cat_transfers', subcategoryId: 'sub_transfers', needsReview: false, isInternalTransfer: true, isPotentialDuplicate: false, isInconsistent: false },
];

export async function POST(req: NextRequest) {
  try {
    const { workspaceId, clear } = await req.json();
    if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });

    const accountsPath = `workspaces/${workspaceId}/accounts`;
    const transactionsPath = `workspaces/${workspaceId}/transactions`;

    if (clear) {
      await db.clearCollection(accountsPath);
      await db.clearCollection(transactionsPath);
    }

    for (const account of DEMO_ACCOUNTS) {
      await db.collection(accountsPath).doc(account.id).set({
        ...account,
        workspaceId,
        createdAt: now(),
        updatedAt: now(),
      });
    }

    for (const tx of buildDemoTransactions()) {
      await db.collection(transactionsPath).doc(tx.id).set({
        ...tx,
        workspaceId,
        createdAt: now(),
        updatedAt: now(),
      });
    }

    return NextResponse.json({ ok: true, accounts: DEMO_ACCOUNTS.length, transactions: buildDemoTransactions().length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
