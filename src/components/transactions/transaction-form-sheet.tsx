
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { Transaction, Category, Subcategory, Account } from '@/lib/types';
import { TransactionFormValues, transactionSchema } from '@/lib/schemas';
import { getSelectableOptions, getTransactionEditHydrationPatch } from '@/lib/transaction-form-hydration';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { format } from 'date-fns';
import { TriangleAlert } from 'lucide-react';
import { getSelectableAccounts, getTransactionTypeChangePatch } from '@/lib/internal-transfer';
import { TransferResolutionPanel } from './transfer-resolution-panel';

interface TransactionFormSheetProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  transaction: Partial<Transaction> | null;
  onSave: (updatedTransaction: Partial<Transaction>) => Promise<Transaction | void>;
  onCreateRuleRequested?: (transaction: Transaction) => void;
  onResolutionComplete?: () => Promise<void> | void;
  categories: (Category & { subcategories: Subcategory[] })[];
  accounts: Account[];
}

export function TransactionFormSheet({
  isOpen,
  onOpenChange,
  transaction,
  onSave,
  onCreateRuleRequested,
  onResolutionComplete,
  categories,
  accounts,
}: TransactionFormSheetProps) {
  const form = useForm<TransactionFormValues>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      accountId: '',
      date: new Date(),
      description: '',
      amountBase: 0,
      type: 'Expense',
      categoryId: undefined,
      subcategoryId: undefined,
      internalDirection: undefined,
      createRule: false,
    },
  });

  const isEditing = !!transaction?.id;
  const hydratedFormKeyRef = useRef<string | null>(null);
  const [renderedFormKey, setRenderedFormKey] = useState<string | null>(null);
  const [resolutionTransaction, setResolutionTransaction] = useState<Transaction | null>(null);
  const [pendingRuleTransaction, setPendingRuleTransaction] = useState<Transaction | null>(null);
  const formKey = isOpen ? transaction?.id ?? 'new' : null;

  useEffect(() => {
    if (!isOpen) {
      hydratedFormKeyRef.current = null;
      setRenderedFormKey(null);
      setResolutionTransaction(null);
      setPendingRuleTransaction(null);
      return;
    }

    if (hydratedFormKeyRef.current === formKey) return;
    hydratedFormKeyRef.current = formKey;

    if (transaction) {
      const resetPayload: TransactionFormValues = {
        id: transaction.id,
        accountId: transaction.accountId ?? '',
        date: transaction.date ? new Date(transaction.date) : new Date(),
        description: transaction.description ?? '',
        amountBase: Math.abs(transaction.amountBase || 0),
        type: transaction.type ?? 'Expense',
        internalDirection:
          transaction.type === 'InternalTransfer'
            ? transaction.internalDirection ?? ((transaction.amountBase ?? 0) < 0 ? 'Out' : 'In')
            : undefined,
        destinationAccountId: transaction.destinationAccountId,
        categoryId: transaction.categoryId,
        subcategoryId: transaction.subcategoryId,
        createRule: false,
      };
      form.reset(resetPayload);
    } else {
      form.reset({
        accountId: '',
        date: new Date(),
        description: '',
        amountBase: 0,
        type: 'Expense',
        categoryId: undefined,
        subcategoryId: undefined,
        internalDirection: undefined,
        destinationAccountId: undefined,
        createRule: false,
      });
    }
    setRenderedFormKey(formKey);
  }, [formKey, form, isOpen, transaction]);

  useEffect(() => {
    if (!isOpen || transaction || accounts.length === 0) return;
    if (!form.getValues('accountId')) {
      const defaultAccount = accounts.find((account) => !account.archived);
      if (defaultAccount) form.setValue('accountId', defaultAccount.id);
    }
  }, [accounts, form, isOpen, transaction]);

  const selectedCategoryId = form.watch('categoryId');
  const selectedType = form.watch('type');
  const selectedAccountId = form.watch('accountId');
  const selectedSubcategoryId = form.watch('subcategoryId');
  const selectedDestinationAccountId = form.watch('destinationAccountId');

  const selectableAccounts = useMemo(
    () => getSelectableAccounts(accounts, selectedAccountId),
    [accounts, selectedAccountId]
  );

  const counterpartAccounts = useMemo(
    () => getSelectableAccounts(
      accounts.filter((account) => account.id !== selectedAccountId),
      selectedDestinationAccountId
    ),
    [accounts, selectedAccountId, selectedDestinationAccountId]
  );

  useEffect(() => {
    if (!isOpen || !transaction?.id) return;

    const patch = getTransactionEditHydrationPatch({
      transaction,
      accounts,
      categories,
      current: {
        accountId: selectedAccountId,
        categoryId: selectedCategoryId,
        subcategoryId: selectedSubcategoryId,
      },
      dirty: {
        accountId: form.getFieldState('accountId').isDirty,
        categoryId: form.getFieldState('categoryId').isDirty,
        subcategoryId: form.getFieldState('subcategoryId').isDirty,
      },
    });

    if (patch.accountId) form.setValue('accountId', patch.accountId);
    if (patch.categoryId) form.setValue('categoryId', patch.categoryId);
    if (patch.subcategoryId) form.setValue('subcategoryId', patch.subcategoryId);
  }, [accounts, categories, form, isOpen, selectedAccountId, selectedCategoryId, selectedSubcategoryId, transaction]);

  useEffect(() => {
    if (selectedType === 'InternalTransfer') {
      const currentDirection = form.getValues('internalDirection');
      if (!currentDirection) {
        form.setValue('internalDirection', 'Out');
      }
      return;
    }

    if (form.getValues('internalDirection')) {
      form.setValue('internalDirection', undefined);
    }
  }, [selectedType, form]);

  const activeCategories = useMemo(
    () => getSelectableOptions(categories, selectedCategoryId),
    [categories, selectedCategoryId]
  );

  const subcategories = useMemo(() => {
    if (!selectedCategoryId) return [];
    const category = categories.find((c) => c.id === selectedCategoryId);
    return getSelectableOptions(category?.subcategories || [], selectedSubcategoryId);
  }, [selectedCategoryId, selectedSubcategoryId, categories]);

  const onSubmit = async (data: TransactionFormValues) => {
    const rawAmount = data.amountBase ?? 0;
    const amount = Math.abs(rawAmount);
    let signedAmount: number;
    const { createRule, internalDirection, ...transactionFields } = data;

    if (transactionFields.type === 'Expense') {
      signedAmount = -amount;
    } else if (transactionFields.type === 'Income') {
      signedAmount = amount;
    } else if (transactionFields.type === 'InternalTransfer') {
      const direction = internalDirection ?? 'Out';
      signedAmount = direction === 'Out' ? -amount : amount;
    } else {
      // Adjustment: keep the raw sign as entered
      signedAmount = rawAmount;
    }

    const transactionToSave: Partial<Transaction> = {
      ...transaction,
      ...transactionFields,
      amountBase: signedAmount,
      amountOriginal: signedAmount, // simplifying for now
      currencyOriginal: 'EUR',
      needsReview: false,
      ...(transaction?.isPotentialDuplicate
        ? { isPotentialDuplicate: false, potentialDuplicateMatch: null }
        : {}),
      ...(internalDirection ? { internalDirection } : {}),
    };
    if (transactionFields.type === 'InternalTransfer') {
      transactionToSave.categoryId = undefined;
      transactionToSave.subcategoryId = undefined;
      transactionToSave.isInternalTransfer = true;
    } else {
      transactionToSave.destinationAccountId = undefined;
      transactionToSave.internalDirection = undefined;
      transactionToSave.linkedTransactionId = undefined;
      transactionToSave.isInternalTransfer = false;
    }
    const saved = await onSave(transactionToSave);
    if (!saved) return;
    if (transaction?.id && saved.type === 'InternalTransfer' && !saved.linkedTransactionId) {
      if (createRule) setPendingRuleTransaction(saved);
      setResolutionTransaction(saved);
      return;
    }
    onOpenChange(false);
    if (createRule) onCreateRuleRequested?.(saved);
  };

  const finishResolution = async () => {
    await onResolutionComplete?.();
    onOpenChange(false);
    if (pendingRuleTransaction) onCreateRuleRequested?.(pendingRuleTransaction);
  };

  const keepUnpaired = () => {
    onOpenChange(false);
    if (pendingRuleTransaction) onCreateRuleRequested?.(pendingRuleTransaction);
  };

  const handleAccountChange = (accountId: string) => {
    form.setValue('accountId', accountId, { shouldDirty: true });
    if (form.getValues('destinationAccountId') === accountId) {
      form.setValue('destinationAccountId', undefined, { shouldDirty: true });
    }
  };

  const handleTypeChange = (type: Transaction['type']) => {
    const previousType = form.getValues('type');
    const patch = getTransactionTypeChangePatch(previousType, type);
    form.setValue('type', type, { shouldDirty: true });
    if ('categoryId' in patch) {
      form.setValue('categoryId', patch.categoryId, { shouldDirty: true });
    }
    if ('subcategoryId' in patch) {
      form.setValue('subcategoryId', patch.subcategoryId, { shouldDirty: true });
    }
    if ('internalDirection' in patch) {
      form.setValue('internalDirection', patch.internalDirection, { shouldDirty: true });
    }
    if ('destinationAccountId' in patch) {
      form.setValue('destinationAccountId', patch.destinationAccountId, { shouldDirty: true });
    }
  };
  
  const handleCategoryChange = (categoryId: string) => {
    form.setValue('categoryId', categoryId, { shouldDirty: true });
    form.setValue('subcategoryId', undefined, { shouldDirty: true });
  }

  const handleSubcategoryChange = (subcategoryId: string) => {
    form.setValue('subcategoryId', subcategoryId, { shouldDirty: true });
    const categoryId = form.getValues('categoryId');
    const category = categories.find((cat) => cat.id === categoryId);
    const subcategory = category?.subcategories?.find((sub) => sub.id === subcategoryId);
    if (subcategory?.flowType) {
      form.setValue('type', subcategory.flowType, { shouldDirty: true });
    }
  }

  if (!isOpen || renderedFormKey !== formKey) return null;

  return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4 h-[90vh] max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden">
          <div className="mb-6 shrink-0">
            <h2 className="text-lg font-semibold">
              {resolutionTransaction ? 'Resolve Internal Transfer' : isEditing ? 'Edit Transaction' : 'New Transaction'}
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              {resolutionTransaction
                ? 'Choose how the counterpart movement should be represented.'
                : isEditing ? 'Update the details for this transaction.' : 'Enter the details for your new transaction.'}
            </p>
          </div>
          {resolutionTransaction ? (
            <TransferResolutionPanel
              transaction={resolutionTransaction}
              accounts={accounts}
              onComplete={finishResolution}
              onKeepUnpaired={keepUnpaired}
            />
          ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 space-y-6">

            {isEditing && transaction?.isPotentialDuplicate && (
              <Alert className="border-orange-400 bg-orange-50 text-orange-950">
                <TriangleAlert className="h-4 w-4 text-orange-600" />
                <AlertTitle>Potential duplicate</AlertTitle>
                <AlertDescription>
                  {transaction.potentialDuplicateMatch ? (
                    <>
                      Matches {new Date(transaction.potentialDuplicateMatch.date).toLocaleDateString()}
                      {' · '}{transaction.potentialDuplicateMatch.description}
                      {' · '}{new Intl.NumberFormat('de-DE', {
                        style: 'currency',
                        currency: 'EUR',
                      }).format(transaction.potentialDuplicateMatch.amountBase)}.
                    </>
                  ) : (
                    <>A matching transaction already exists.</>
                  )}{' '}
                  Review the details below. Choosing Keep anyway explicitly confirms that both
                  transactions should remain.
                </AlertDescription>
              </Alert>
            )}
            
            <FormField
              control={form.control}
              name="accountId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Account</FormLabel>
                  <Select
                    onValueChange={handleAccountChange}
                    value={field.value ?? ''}
                    disabled={isEditing && transaction?.type === 'InternalTransfer'}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select an account" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {selectableAccounts.map((acc) => (
                        <SelectItem key={acc.id} value={acc.id}>
                          {acc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="date"
              render={({ field }) => {
                const rawValue = field.value;
                const dateValue =
                  rawValue instanceof Date
                    ? rawValue
                    : rawValue
                    ? new Date(rawValue)
                    : undefined;
                const inputValue = dateValue ? format(dateValue, "yyyy-MM-dd") : "";

                return (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        value={inputValue}
                        onChange={(e) => {
                          const value = e.target.value;
                          field.onChange(value ? new Date(value) : null);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Dinner with friends" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="amountBase"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount (Absolute)</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} />
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
                    <FormLabel>Type</FormLabel>
                    <Select
                      onValueChange={(value) => handleTypeChange(value as Transaction['type'])}
                      value={field.value}
                      disabled={!!transaction?.linkedTransactionId && transaction.type === 'InternalTransfer'}
                    >
                        <FormControl>
                        <SelectTrigger>
                            <SelectValue placeholder="Select transaction type" />
                        </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                            <SelectItem value="Expense">Expense</SelectItem>
                            <SelectItem value="Income">Income</SelectItem>
                            <SelectItem value="InternalTransfer">Internal Transfer</SelectItem>
                            <SelectItem value="Adjustment">Adjustment</SelectItem>
                        </SelectContent>
                    </Select>
                    <FormMessage />
                    </FormItem>
                )}
            />

            {selectedType === 'InternalTransfer' && (
              <>
                <FormField
                  control={form.control}
                  name="internalDirection"
                  render={({ field }) => (
                    <FormItem className="mt-2">
                      <FormLabel>Transfer direction</FormLabel>
                        <RadioGroup
                        className="flex gap-4"
                        value={field.value ?? 'Out'}
                          onValueChange={field.onChange}
                          disabled={!!transaction?.linkedTransactionId}
                      >
                        <FormItem className="flex items-center space-x-2">
                          <FormControl>
                            <RadioGroupItem value="Out" />
                          </FormControl>
                          <FormLabel className="font-normal">Out of this account</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-2">
                          <FormControl>
                            <RadioGroupItem value="In" />
                          </FormControl>
                          <FormLabel className="font-normal">Into this account</FormLabel>
                        </FormItem>
                      </RadioGroup>
                      <FormDescription>
                        Use this to indicate if the amount is leaving or entering this account.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                    control={form.control}
                    name="destinationAccountId"
                    render={({ field }) => {
                      return (
                        <FormItem>
                          <FormLabel>Counterpart Account</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value ?? ''}
                            disabled={!!transaction?.linkedTransactionId}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select the counterpart account" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {counterpartAccounts.map((acc) => (
                                <SelectItem key={acc.id} value={acc.id}>
                                  {acc.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormDescription>
                            {isEditing
                              ? transaction?.linkedTransactionId
                                ? 'This counterpart is fixed because the transfer already has a linked pair.'
                                : 'Editing this transaction will not create a reciprocal transaction.'
                              : 'The matching transaction will be created automatically in this account.'}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      );
                    }}
                  />
              </>
            )}


            {selectedType !== 'InternalTransfer' && (<FormField
              control={form.control}
              name="categoryId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                    <Select onValueChange={handleCategoryChange} value={field.value ?? ''}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a category" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {activeCategories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />)}

            {selectedType !== 'InternalTransfer' && subcategories.length > 0 && (
              <FormField
                control={form.control}
                name="subcategoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Subcategory</FormLabel>
                      <Select onValueChange={handleSubcategoryChange} value={field.value ?? ''}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a subcategory" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {subcategories.map((sub) => (
                          <SelectItem key={sub.id} value={sub.id}>
                            {sub.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {isEditing && (<FormField
              control={form.control}
              name="createRule"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 shadow-sm">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Create Classification Rule</FormLabel>
                    <FormDescription>
                      Apply this classification to similar future transactions.
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />)}

            </div>

            <div className="flex shrink-0 gap-2 justify-end mt-8 pt-4 border-t bg-white">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting
                  ? 'Saving…'
                  : transaction?.isPotentialDuplicate ? 'Keep anyway' : 'Save Changes'}
              </Button>
            </div>
            </form>
          </Form>
          )}
        </div>
      </div>
  );
}
