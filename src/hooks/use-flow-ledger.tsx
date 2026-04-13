'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import type { Account, Category, Subcategory, Transaction, Workspace } from '@/lib/types';
import {
  apiGetWorkspaces,
  apiGetAccounts,
  apiGetTransactions,
  apiGetCategories,
} from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

const DEFAULT_WORKSPACE_ID = 'ws1';

interface FlowLedgerContextType {
  workspaces: Workspace[];
  workspaceId: string;
  setWorkspaceId: (id: string) => void;
  accounts: Account[];
  transactions: Transaction[];
  categories: (Category & { subcategories: Subcategory[] })[];
  isLoading: boolean;
  reloadWorkspaces: () => Promise<void>;
  reloadAccounts: () => Promise<void>;
  reloadTransactions: () => Promise<void>;
  reloadCategories: () => Promise<void>;
}

const FlowLedgerContext = createContext<FlowLedgerContextType | undefined>(undefined);

export const FlowLedgerProvider = ({ children }: { children: ReactNode }) => {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string>(DEFAULT_WORKSPACE_ID);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<(Category & { subcategories: Subcategory[] })[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const fetchWorkspaces = useCallback(async () => {
    try {
      const data = await apiGetWorkspaces();
      setWorkspaces(data);
      if (data.length > 0 && !data.find((w) => w.id === workspaceId)) {
        setWorkspaceId(data[0].id);
      }
    } catch (e) {
      console.error('Failed to load workspaces:', e);
      toast({ title: 'Failed to load workspaces', description: (e as Error).message, variant: 'destructive' });
    }
  }, [workspaceId, toast]);

  const fetchAccounts = useCallback(async () => {
    try {
      const data = await apiGetAccounts(workspaceId);
      setAccounts(data);
    } catch (e) {
      console.error('Failed to load accounts:', e);
      toast({ title: 'Failed to load accounts', description: (e as Error).message, variant: 'destructive' });
    }
  }, [workspaceId, toast]);

  const fetchTransactions = useCallback(async () => {
    try {
      const data = await apiGetTransactions(workspaceId);
      setTransactions(
        data.map((t) => ({ ...t, date: new Date(t.date), valueDate: t.valueDate ? new Date(t.valueDate) : undefined }))
      );
    } catch (e) {
      console.error('Failed to load transactions:', e);
      toast({ title: 'Failed to load transactions', description: (e as Error).message, variant: 'destructive' });
    }
  }, [workspaceId, toast]);

  const fetchCategories = useCallback(async () => {
    try {
      const data = await apiGetCategories();
      setCategories(data);
    } catch (e) {
      console.error('Failed to load categories:', e);
      toast({ title: 'Failed to load categories', description: (e as Error).message, variant: 'destructive' });
    }
  }, [toast]);

  useEffect(() => {
    setIsLoading(true);
    Promise.all([fetchWorkspaces(), fetchCategories()]).finally(() => {
      // accounts/transactions load in the next effect; keep loading until those finish
    });
  }, [fetchWorkspaces, fetchCategories]);

  useEffect(() => {
    setIsLoading(true);
    Promise.all([fetchAccounts(), fetchTransactions()]).finally(() => {
      setIsLoading(false);
    });
  }, [workspaceId, fetchAccounts, fetchTransactions]);

  return (
    <FlowLedgerContext.Provider
      value={{
        workspaces,
        workspaceId,
        setWorkspaceId,
        accounts,
        transactions,
        categories,
        isLoading,
        reloadWorkspaces: fetchWorkspaces,
        reloadAccounts: fetchAccounts,
        reloadTransactions: fetchTransactions,
        reloadCategories: fetchCategories,
      }}
    >
      {children}
    </FlowLedgerContext.Provider>
  );
};

export const useFlowLedger = () => {
  const context = useContext(FlowLedgerContext);
  if (!context) throw new Error('useFlowLedger must be used within a FlowLedgerProvider');
  return context;
};
