'use client';

import React from 'react';
import { PlusCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AccountCard } from '@/components/accounts/account-card';
import { useFlowLedger } from '@/hooks/use-flow-ledger';
import { useState, useMemo, useCallback } from 'react';
import type { Account } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { apiArchiveAccount, apiDeleteAccount, apiSaveAccount } from '@/lib/api';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { accountSchema, type AccountFormValues } from '@/lib/schemas';
import { calculateAccountBalance } from '@/lib/transaction-reporting';

export default function AccountsPage() {
  const { accounts, transactions, workspaceId, reloadAccounts } = useFlowLedger();

  // Compute real balance per account: openingBalance + sum of confirmed transactions
  const balanceByAccountId = useMemo(() => {
    return Object.fromEntries(
      accounts.map((account) => [account.id, calculateAccountBalance(account, transactions)])
    );
  }, [accounts, transactions]);

  const { toast } = useToast();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);

  React.useEffect(() => {
    setIsSheetOpen(false);
    setEditingAccount(null);
  }, [workspaceId]);

  const handleAddAccount = useCallback(() => {
    setEditingAccount(null);
    setIsSheetOpen(true);
  }, []);

  const handleEditAccount = useCallback((account: Account) => {
    setEditingAccount(account);
    setIsSheetOpen(true);
  }, []);

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

    // Reload accounts to show updated data
    reloadAccounts();
  };

  const handleArchiveAccount = useCallback(async (account: Account) => {
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
  }, [workspaceId, toast, reloadAccounts]);

  const handleDeleteAccount = useCallback(async (account: Account) => {
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
  }, [workspaceId, toast, reloadAccounts]);

  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      name: '',
      type: 'bank',
      currency: 'EUR',
      institution: '',
      openingBalance: 0,
    },
  });

  // Update form values when editing account changes
  React.useEffect(() => {
    if (editingAccount) {
      form.reset({
        name: editingAccount.name,
        type: editingAccount.type,
        currency: editingAccount.currency,
        institution: editingAccount.institution,
        openingBalance: editingAccount.openingBalance,
      });
    } else {
      form.reset({
        name: '',
        type: 'bank',
        currency: 'EUR',
        institution: '',
        openingBalance: 0,
      });
    }
  }, [editingAccount, isSheetOpen, form]);

  const onSubmit = async (data: AccountFormValues) => {
    try {
      await handleSaveAccount({ id: editingAccount?.id, ...data });
    } catch (error) {
      console.error('Failed to save:', error);
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

      {isSheetOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-lg">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">
                {editingAccount ? 'Edit Account' : 'Add New Account'}
              </h2>
              <button
                onClick={() => setIsSheetOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Main Checking Account" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select an account type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="bank">Bank Account</SelectItem>
                        <SelectItem value="credit_card">Credit Card</SelectItem>
                        <SelectItem value="fintech">Fintech (e.g., Revolut)</SelectItem>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="investment">Investment</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="institution"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Financial Institution</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Bank of America" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="openingBalance"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Opening Balance</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          {...field}
                          value={field.value ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            field.onChange(value === '' ? 0 : parseFloat(value));
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="currency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Currency</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select currency" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="EUR">EUR</SelectItem>
                          <SelectItem value="USD">USD</SelectItem>
                          <SelectItem value="GBP">GBP</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
                <div className="flex gap-2 justify-end pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsSheetOpen(false)}
                    disabled={form.formState.isSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        </div>
      )}

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
    </div>
  );
}
