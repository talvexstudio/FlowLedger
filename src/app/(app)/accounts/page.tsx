'use client';

import { PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AccountCard } from '@/components/accounts/account-card';
import { useFlowLedger } from '@/hooks/use-flow-ledger';
import { AccountFormSheet } from '@/components/accounts/account-form-sheet';
import { useState, useMemo } from 'react';
import type { Account } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { apiArchiveAccount, apiDeleteAccount, apiSaveAccount } from '@/lib/api';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';

export default function AccountsPage() {
  const { accounts, transactions, workspaceId, reloadAccounts } = useFlowLedger();

  // Compute real balance per account: openingBalance + sum of confirmed transactions
  const balanceByAccountId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const account of accounts) {
      map[account.id] = account.openingBalance ?? 0;
    }
    for (const tx of transactions) {
      if (!tx.needsReview && tx.accountId && map[tx.accountId] !== undefined) {
        map[tx.accountId] += tx.amountBase;
      }
    }
    return map;
  }, [accounts, transactions]);
  const { toast } = useToast();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);

  const handleAddAccount = () => {
    setEditingAccount(null);
    setIsSheetOpen(true);
  };

  const handleEditAccount = (account: Account) => {
    setEditingAccount(account);
    setIsSheetOpen(true);
  };

  const handleSaveAccount = async (values: Partial<Account>) => {
    if (!workspaceId) return;

    // Let errors propagate to the form's catch block so the sheet stays open
    await apiSaveAccount(workspaceId, values);

    toast({
      title: `Account ${values.id ? 'updated' : 'created'}`,
      description: `The account "${values.name}" has been successfully saved.`,
    });

    // Close form FIRST to prevent form component from interfering with state updates
    setIsSheetOpen(false);
    setEditingAccount(null);

    // Then reload data (form won't interfere)
    await reloadAccounts();
  };

  const handleArchiveAccount = async (account: Account) => {
    if (!workspaceId || !account.id) return;
    try {
      await apiArchiveAccount(workspaceId, account.id);
      toast({
        title: 'Account Archived',
        description: `The account "${account.name}" has been archived.`,
      });
      await reloadAccounts();
    } catch (error) {
      console.error('Failed to archive account:', error);
      toast({
        variant: 'destructive',
        title: 'Archive Failed',
        description: 'Could not archive the account. Please try again.',
      });
    }
  };

  const handleDeleteAccount = async (account: Account) => {
    if (!workspaceId || !account.id) return;
    try {
      await apiDeleteAccount(workspaceId, account.id);
      toast({
        title: 'Account Deleted',
        description: `The account "${account.name}" has been deleted.`,
      });
      await reloadAccounts();
    } catch (error: any) {
      console.error('Failed to delete account:', error);
      toast({
        variant: 'destructive',
        title: 'Delete Failed',
        description: error.message || 'Could not delete the account. Please try again.',
      });
    }
  };


  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Accounts</h1>
          <p className="text-muted-foreground">Manage your financial accounts.</p>
        </div>
        <Button onClick={handleAddAccount}>
          <PlusCircle />
          Add Account
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {(accounts || []).filter(a => !a.archived).map((account) => (
          <AccountCard
            key={account.id}
            account={account}
            balance={balanceByAccountId[account.id] ?? account.openingBalance ?? 0}
            onEdit={() => handleEditAccount(account)}
            onArchive={() => handleArchiveAccount(account)}
            onDelete={() => handleDeleteAccount(account)}
          />
        ))}
      </div>

       <AccountFormSheet
        isOpen={isSheetOpen}
        onOpenChange={setIsSheetOpen}
        account={editingAccount}
        onSave={handleSaveAccount}
      />
    </div>
  );
}
