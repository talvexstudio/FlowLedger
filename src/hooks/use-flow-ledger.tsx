'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode, useMemo } from 'react';
import type { Account, BudgetLine, Category, Subcategory, Transaction, Workspace } from '@/lib/types';
import {
  apiGetWorkspaces,
  apiGetAccounts,
  apiGetTransactions,
  apiGetCategories,
  apiGetBudget,
} from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import {
  initializeWorkspaceSelection,
  persistWorkspaceId,
  type WorkspaceSelectionStorage,
} from '@/lib/workspace-selection';

interface FlowLedgerContextType {
  workspaces: Workspace[];
  workspaceId: string | null;
  setWorkspaceId: (id: string) => void;
  accounts: Account[];
  transactions: Transaction[];
  categories: (Category & { subcategories: Subcategory[] })[];
  budgetLines: BudgetLine[];
  budgetYear: number;
  isLoading: boolean;
  reloadWorkspaces: () => Promise<void>;
  reloadAccounts: () => Promise<void>;
  reloadTransactions: () => Promise<void>;
  reloadCategories: () => Promise<void>;
  reloadBudget: (year?: number) => Promise<void>;
}

const FlowLedgerContext = createContext<FlowLedgerContextType | undefined>(undefined);

export const FlowLedgerProvider = ({ children }: { children: ReactNode }) => {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceIdState] = useState<string | null>(null);
  const [workspacesInitialized, setWorkspacesInitialized] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<(Category & { subcategories: Subcategory[] })[]>([]);
  const [budgetLines, setBudgetLines] = useState<BudgetLine[]>([]);
  const [budgetYear, setBudgetYear] = useState<number>(new Date().getFullYear());
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const getBrowserStorage = (): WorkspaceSelectionStorage | null => {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  };

  const fetchWorkspaces = useCallback(async () => {
    try {
      const data = await apiGetWorkspaces();
      setWorkspaces(data);
      setWorkspaceIdState(initializeWorkspaceSelection(data, getBrowserStorage()));
    } catch (e) {
      setWorkspaces([]);
      setWorkspaceIdState(null);
      console.error('Failed to load workspaces:', e);
      toastRef.current({ title: 'Failed to load workspaces', description: (e as Error).message, variant: 'destructive' });
    }
  }, []);

  const setWorkspaceId = useCallback((id: string) => {
    if (!workspaces.some((workspace) => workspace.id === id)) return;
    persistWorkspaceId(getBrowserStorage(), id);
    setCategories([]);
    setWorkspaceIdState(id);
  }, [workspaces]);

  const fetchAccounts = useCallback(async () => {
    if (!workspaceId) {
      setAccounts([]);
      return;
    }
    try {
      const data = await apiGetAccounts(workspaceId);
      setAccounts(data);
    } catch (e) {
      console.error('Failed to load accounts:', e);
      toastRef.current({ title: 'Failed to load accounts', description: (e as Error).message, variant: 'destructive' });
    }
  }, [workspaceId]);

  const fetchTransactions = useCallback(async () => {
    if (!workspaceId) {
      setTransactions([]);
      return;
    }
    try {
      const data = await apiGetTransactions(workspaceId);
      setTransactions(
        data.map((t) => ({ ...t, date: new Date(t.date), valueDate: t.valueDate ? new Date(t.valueDate) : undefined }))
      );
    } catch (e) {
      console.error('Failed to load transactions:', e);
      toastRef.current({ title: 'Failed to load transactions', description: (e as Error).message, variant: 'destructive' });
    }
  }, [workspaceId]);

  const fetchCategories = useCallback(async () => {
    if (!workspaceId) {
      setCategories([]);
      return;
    }
    try {
      const data = await apiGetCategories(workspaceId);
      setCategories(data);
    } catch (e) {
      console.error('Failed to load categories:', e);
      toastRef.current({ title: 'Failed to load categories', description: (e as Error).message, variant: 'destructive' });
    }
  }, [workspaceId]);

  const fetchBudget = useCallback(async (year?: number) => {
    const targetYear = year ?? budgetYear;
    if (year && year !== budgetYear) setBudgetYear(year);
    if (!workspaceId) {
      setBudgetLines([]);
      return;
    }
    try {
      const { lines } = await apiGetBudget(workspaceId, targetYear);
      setBudgetLines(lines);
    } catch (e) {
      console.error('Failed to load budget:', e);
    }
  }, [workspaceId, budgetYear]);

  useEffect(() => {
    setIsLoading(true);
    fetchWorkspaces().finally(() => {
      setWorkspacesInitialized(true);
    });
  }, [fetchWorkspaces]);

  useEffect(() => {
    if (!workspacesInitialized) return;
    if (!workspaceId) {
      setAccounts([]);
      setTransactions([]);
      setCategories([]);
      setBudgetLines([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    Promise.all([fetchAccounts(), fetchTransactions(), fetchCategories(), fetchBudget()]).finally(() => {
      setIsLoading(false);
    });
  }, [fetchAccounts, fetchBudget, fetchCategories, fetchTransactions, workspaceId, workspacesInitialized]);

  const contextValue = useMemo(() => ({
    workspaces,
    workspaceId,
    setWorkspaceId,
    accounts,
    transactions,
    categories,
    budgetLines,
    budgetYear,
    isLoading,
    reloadWorkspaces: fetchWorkspaces,
    reloadAccounts: fetchAccounts,
    reloadTransactions: fetchTransactions,
    reloadCategories: fetchCategories,
    reloadBudget: fetchBudget,
  }), [workspaces, workspaceId, accounts, transactions, categories, budgetLines, budgetYear, isLoading]);

  return (
    <FlowLedgerContext.Provider value={contextValue}>
      {children}
    </FlowLedgerContext.Provider>
  );
};

export const useFlowLedger = () => {
  const context = useContext(FlowLedgerContext);
  if (!context) throw new Error('useFlowLedger must be used within a FlowLedgerProvider');
  return context;
};
