'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode, useMemo } from 'react';
import type { Account, BudgetLine, Category, Subcategory, Transaction, Workspace } from '@/lib/types';
import {
  apiGetWorkspaces,
  apiGetAccounts,
  apiGetTransactions,
  apiGetCategories,
  apiGetBudget,
  apiCreateWorkspace,
  apiRenameWorkspace,
} from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import {
  initializeWorkspaceSelection,
  persistWorkspaceId,
  type WorkspaceSelectionStorage,
} from '@/lib/workspace-selection';
import {
  appendCreatedWorkspace,
  isWorkspaceResponseCurrent,
  replaceRenamedWorkspace,
} from '@/lib/workspace-client-state';
import type { CreateWorkspaceInput } from '@/lib/workspace-lifecycle-types';

interface FlowLedgerContextType {
  workspaces: Workspace[];
  workspaceId: string | null;
  setWorkspaceId: (id: string) => void;
  createWorkspace: (input: CreateWorkspaceInput) => Promise<Workspace>;
  renameWorkspace: (name: string) => Promise<Workspace>;
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
  const workspaceIdRef = useRef<string | null>(null);
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
      const selectedWorkspaceId = initializeWorkspaceSelection(data, getBrowserStorage());
      setWorkspaces(data);
      workspaceIdRef.current = selectedWorkspaceId;
      setWorkspaceIdState(selectedWorkspaceId);
    } catch (e) {
      setWorkspaces([]);
      workspaceIdRef.current = null;
      setWorkspaceIdState(null);
      console.error('Failed to load workspaces:', e);
      toastRef.current({ title: 'Failed to load workspaces', description: (e as Error).message, variant: 'destructive' });
    }
  }, []);

  const setWorkspaceId = useCallback((id: string) => {
    if (!workspaces.some((workspace) => workspace.id === id)) return;
    persistWorkspaceId(getBrowserStorage(), id);
    workspaceIdRef.current = id;
    setAccounts([]);
    setTransactions([]);
    setCategories([]);
    setBudgetLines([]);
    setWorkspaceIdState(id);
  }, [workspaces]);

  const createWorkspace = useCallback(async (input: CreateWorkspaceInput) => {
    const result = await apiCreateWorkspace(input);
    const created = {
      ...result.workspace,
      createdAt: new Date(result.workspace.createdAt),
      updatedAt: new Date(result.workspace.updatedAt),
    };
    setWorkspaces((current) => appendCreatedWorkspace(current, created));
    persistWorkspaceId(getBrowserStorage(), created.id);
    workspaceIdRef.current = created.id;
    setAccounts([]);
    setTransactions([]);
    setCategories([]);
    setBudgetLines([]);
    setWorkspaceIdState(created.id);
    return created;
  }, []);

  const renameWorkspace = useCallback(async (name: string) => {
    const currentWorkspaceId = workspaceIdRef.current;
    if (!currentWorkspaceId) throw new Error('No workspace is selected.');
    const result = await apiRenameWorkspace(currentWorkspaceId, name);
    const renamed = {
      ...result,
      createdAt: new Date(result.createdAt),
      updatedAt: new Date(result.updatedAt),
    };
    setWorkspaces((current) => replaceRenamedWorkspace(current, renamed));
    return renamed;
  }, []);

  const fetchAccounts = useCallback(async () => {
    if (!workspaceId) {
      setAccounts([]);
      return;
    }
    const requestedWorkspaceId = workspaceId;
    try {
      const data = await apiGetAccounts(workspaceId);
      if (isWorkspaceResponseCurrent(workspaceIdRef.current, requestedWorkspaceId)) setAccounts(data);
    } catch (e) {
      if (!isWorkspaceResponseCurrent(workspaceIdRef.current, requestedWorkspaceId)) return;
      console.error('Failed to load accounts:', e);
      toastRef.current({ title: 'Failed to load accounts', description: (e as Error).message, variant: 'destructive' });
    }
  }, [workspaceId]);

  const fetchTransactions = useCallback(async () => {
    if (!workspaceId) {
      setTransactions([]);
      return;
    }
    const requestedWorkspaceId = workspaceId;
    try {
      const data = await apiGetTransactions(workspaceId);
      if (isWorkspaceResponseCurrent(workspaceIdRef.current, requestedWorkspaceId)) setTransactions(
        data.map((t) => ({ ...t, date: new Date(t.date), valueDate: t.valueDate ? new Date(t.valueDate) : undefined }))
      );
    } catch (e) {
      if (!isWorkspaceResponseCurrent(workspaceIdRef.current, requestedWorkspaceId)) return;
      console.error('Failed to load transactions:', e);
      toastRef.current({ title: 'Failed to load transactions', description: (e as Error).message, variant: 'destructive' });
    }
  }, [workspaceId]);

  const fetchCategories = useCallback(async () => {
    if (!workspaceId) {
      setCategories([]);
      return;
    }
    const requestedWorkspaceId = workspaceId;
    try {
      const data = await apiGetCategories(workspaceId);
      if (isWorkspaceResponseCurrent(workspaceIdRef.current, requestedWorkspaceId)) setCategories(data);
    } catch (e) {
      if (!isWorkspaceResponseCurrent(workspaceIdRef.current, requestedWorkspaceId)) return;
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
    const requestedWorkspaceId = workspaceId;
    try {
      const { lines } = await apiGetBudget(workspaceId, targetYear);
      if (isWorkspaceResponseCurrent(workspaceIdRef.current, requestedWorkspaceId)) setBudgetLines(lines);
    } catch (e) {
      if (!isWorkspaceResponseCurrent(workspaceIdRef.current, requestedWorkspaceId)) return;
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
    createWorkspace,
    renameWorkspace,
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
  }), [workspaces, workspaceId, setWorkspaceId, createWorkspace, renameWorkspace, accounts, transactions, categories, budgetLines, budgetYear, isLoading, fetchWorkspaces, fetchAccounts, fetchTransactions, fetchCategories, fetchBudget]);

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
