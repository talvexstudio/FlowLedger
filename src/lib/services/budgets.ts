import { db } from './firestore';
import type { Budget, BudgetLine } from '../types';

const budgetsCollection = (workspaceId: string) =>
  db.collection(`workspaces/${workspaceId}/budgets`);

const budgetCreationQueues = new Map<string, Promise<void>>();

const withBudgetCreationLock = async <T>(
  workspaceId: string,
  year: number,
  operation: () => Promise<T>
): Promise<T> => {
  const key = `${workspaceId}:${year}`;
  const previous = budgetCreationQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  budgetCreationQueues.set(key, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (budgetCreationQueues.get(key) === tail) budgetCreationQueues.delete(key);
  }
};

type StoredBudgetLine = Partial<BudgetLine> & {
  recordType: 'line';
  workspaceId: string;
  year: number;
  budgetId: string;
};

const isBudgetLine = (data: any): data is StoredBudgetLine => data?.recordType === 'line';

const findBudgetDocuments = async (workspaceId: string, year: number) => {
  const snapshot = await budgetsCollection(workspaceId).get();
  return snapshot.docs.filter((doc: any) => {
    const data = doc.data();
    return !isBudgetLine(data) && data?.year === year;
  });
};

const findBudgetDocument = async (workspaceId: string, year: number) => {
  const matches = await findBudgetDocuments(workspaceId, year);
  if (matches.length > 1) {
    throw new Error('More than one budget exists for this workspace and year.');
  }
  return matches[0];
};

const findBudgetLineDocument = async (
  workspaceId: string,
  year: number,
  categoryId: string
) => {
  const snapshot = await budgetsCollection(workspaceId).get();
  return snapshot.docs.find((doc: any) => {
    const data = doc.data();
    return isBudgetLine(data) && data.year === year && data.categoryId === categoryId;
  });
};

export const getBudget = async (
  workspaceId: string,
  year: number
): Promise<{ budget: Budget | null; lines: BudgetLine[] }> => {
  const snapshot = await budgetsCollection(workspaceId).get();
  const budgetDocs = snapshot.docs.filter((doc: any) => {
    const data = doc.data();
    return !isBudgetLine(data) && data?.year === year;
  });
  if (budgetDocs.length > 1) {
    throw new Error('More than one budget exists for this workspace and year.');
  }
  const budgetDoc = budgetDocs[0];

  if (!budgetDoc) return { budget: null, lines: [] };

  const budget = { id: budgetDoc.id, ...budgetDoc.data() } as Budget;
  const lines = snapshot.docs
    .filter((doc: any) => {
      const data = doc.data();
      return isBudgetLine(data) && data.year === year && data.budgetId === budget.id;
    })
    .map((doc: any) => {
      const { recordType, workspaceId: _workspaceId, year: _year, ...line } = doc.data();
      return { id: doc.id, ...line } as BudgetLine;
    });

  return { budget, lines };
};

export const ensureBudget = async (workspaceId: string, year: number): Promise<Budget> => {
  return withBudgetCreationLock(workspaceId, year, async () => {
    const existing = await findBudgetDocument(workspaceId, year);
    if (existing) return { id: existing.id, ...existing.data() } as Budget;

    const budgetData: Omit<Budget, 'id'> = {
      workspaceId,
      year,
      createdFromSampleMonths: 3,
      samplePeriodFrom: `${year}-01`,
      samplePeriodTo: `${year}-12`,
      createdAt: new Date(),
    };
    // New budget headers use the store's globally unique generated ID. Legacy
    // headers whose ID is the year remain readable through the workspace+year lookup.
    const docRef = await budgetsCollection(workspaceId).add(budgetData);
    return { id: docRef.id, ...budgetData };
  });
};

export const saveBudgetLine = async (
  workspaceId: string,
  year: number,
  line: Partial<BudgetLine>
): Promise<BudgetLine> => {
  const budget = await ensureBudget(workspaceId, year);
  const categoryId = line.categoryId!;
  const existing = await findBudgetLineDocument(workspaceId, year, categoryId);
  const { id: _lineId, ...lineData } = line;
  const storedLine: StoredBudgetLine = {
    ...lineData,
    recordType: 'line',
    workspaceId,
    year,
    budgetId: budget.id,
  };

  if (existing) {
    await budgetsCollection(workspaceId).doc(existing.id).set(storedLine, { merge: true });
    return { id: existing.id, ...lineData } as BudgetLine;
  }

  const lineRef = await budgetsCollection(workspaceId).add(storedLine);
  return { id: lineRef.id, ...lineData } as BudgetLine;
};

export const deleteBudgetLine = async (
  workspaceId: string,
  year: number,
  categoryId: string
): Promise<void> => {
  const existing = await findBudgetLineDocument(workspaceId, year, categoryId);
  if (existing) {
    await budgetsCollection(workspaceId).doc(existing.id).delete();
  }
};
