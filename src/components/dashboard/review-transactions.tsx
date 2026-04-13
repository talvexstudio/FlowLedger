'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Check, Edit, MoreVertical } from 'lucide-react';
import type { ClassificationRule, Transaction } from '@/lib/types';
import { TransactionFormSheet } from '../transactions/transaction-form-sheet';
import { useToast } from '@/hooks/use-toast';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useFlowLedger } from '@/hooks/use-flow-ledger';
import { apiConfirmTransaction, apiSaveTransaction, apiSaveRule } from '@/lib/api';
import { applyRuleClassificationToTransaction, ruleMatchesTransactionForBackfill } from '@/lib/utils/rule-utils';
import { RuleBackfillPanel } from '@/components/transactions/rule-backfill-panel';

interface ReviewTransactionsProps {
  transactions: Transaction[];
}

export function ReviewTransactions({ transactions: initialTransactions }: ReviewTransactionsProps) {
  const { toast } = useToast();
  const { categories, accounts, reloadTransactions, workspaceId, transactions } = useFlowLedger();
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [backfillCandidates, setBackfillCandidates] = useState<Transaction[]>([]);
  const [pendingRule, setPendingRule] = useState<(ClassificationRule & { categoryName?: string; subcategoryName?: string }) | null>(null);
  const backfillPanelRef = useRef<HTMLDivElement | null>(null);

  const getCategoryName = (catId?: string) => categories.find(c => c.id === catId)?.name || 'Uncategorized';
  const getSubcategoryName = (subcatId?: string) => {
    for (const cat of categories) {
        const sub = cat.subcategories.find(s => s.id === subcatId);
        if (sub) return sub.name;
    }
    return '';
  }
  const getAccountName = (accId: string) => accounts.find(a => a.id === accId)?.name || 'Unknown Account';
  
  const handleApprove = async (transactionId: string) => {
    if (!workspaceId) return;
    try {
      await apiConfirmTransaction(workspaceId, transactionId);
      await reloadTransactions();
      toast({
        title: "Transaction Approved",
        description: "The transaction has been successfully categorized.",
      });
    } catch(error) {
      console.error(error);
      toast({
        variant: 'destructive',
        title: 'Approval failed',
        description: 'Could not approve transaction.'
      });
    }
  };
  
  const handleSave = async (updatedTransaction: Partial<Transaction>, createRule: boolean) => {
    if (!workspaceId) return;
    try {
        const saved = await apiSaveTransaction(workspaceId, updatedTransaction);
        setEditingTransaction(null);
        await reloadTransactions();
        toast({
          title: "Transaction Updated",
          description: "Your changes have been saved.",
        });
        if (createRule) {
          const descriptionSource = saved.rawDescription || saved.description || "";
          const descriptionToken = extractRuleTokenFromDescription(descriptionSource);
          if (descriptionToken && saved.id) {
            const ruleData: Omit<ClassificationRule, "id"> = {
              workspaceId,
              match: {
                descriptionContains: descriptionToken,
                accountId: saved.accountId,
              },
              action: {
                categoryId: saved.categoryId,
                subcategoryId: saved.subcategoryId,
                type: saved.type,
              },
              createdFromTransactionId: saved.id,
              createdAt: new Date(),
            };
            const createdRule = await apiSaveRule(workspaceId, ruleData);
            toast({
              title: "Classification Rule Created",
              description: "A new rule has been created for similar transactions.",
            });
            const candidates = transactions.filter(
              (tx) => tx.id !== saved.id && ruleMatchesTransactionForBackfill(createdRule, tx)
            );
            if (candidates.length > 0) {
              const categoryName = categories.find((c) => c.id === createdRule.action.categoryId)?.name;
              const subcategoryName = categories
                .find((c) => c.id === createdRule.action.categoryId)
                ?.subcategories.find((s) => s.id === createdRule.action.subcategoryId)?.name;
              setPendingRule({ ...createdRule, categoryName, subcategoryName });
              setBackfillCandidates(candidates);
              toast({
                title: "Rule suggestions available",
                description: `We found ${candidates.length} similar transaction(s). Review and apply the rule above.`,
              });
            }
          }
        }
    } catch (error) {
        console.error(error);
        toast({
            variant: 'destructive',
            title: 'Update failed',
            description: 'Could not save transaction changes.',
        });
    }
  };

  const handleConfirmBackfill = async (selectedIds: string[]) => {
    if (!workspaceId || !pendingRule) return;
    const rule = pendingRule;
    const candidates = backfillCandidates;

    setBackfillCandidates([]);
    setPendingRule(null);

    try {
      const selected = candidates.filter((tx) => selectedIds.includes(tx.id));
      if (selected.length > 0) {
        for (const tx of selected) {
          const patch = applyRuleClassificationToTransaction(tx, rule, categories);
          await apiSaveTransaction(workspaceId, patch);
        }
        await reloadTransactions();
        toast({
          title: "Rule applied",
          description: `Applied classification to ${selected.length} transaction(s).`,
        });
      }
    } catch (error) {
      console.error(error);
      toast({
        variant: 'destructive',
        title: 'Backfill failed',
        description: 'Could not apply the rule to selected transactions.',
      });
    }
  };

  useEffect(() => {
    if (pendingRule && backfillCandidates.length > 0 && backfillPanelRef.current) {
      const element = backfillPanelRef.current;
      const rect = element.getBoundingClientRect();
      const absoluteTop = rect.top + window.scrollY;
      const headerOffset = 96; // adjust if header height changes
      window.scrollTo({
        top: Math.max(absoluteTop - headerOffset, 0),
        behavior: 'smooth',
      });
    }
  }, [pendingRule, backfillCandidates.length]);

  if (initialTransactions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Transactions to Review</CardTitle>
          <CardDescription>All your transactions are categorized. Great job!</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground p-8">
            No transactions to review.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {pendingRule && backfillCandidates.length > 0 && (
        <div ref={backfillPanelRef}>
          <RuleBackfillPanel
            rule={pendingRule}
            transactions={backfillCandidates}
            onApply={handleConfirmBackfill}
            onCancel={() => {
              setBackfillCandidates([]);
              setPendingRule(null);
            }}
          />
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Transactions to Review
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {initialTransactions.length}
            </span>
          </CardTitle>
          <CardDescription>Confirm or edit the classification for these transactions.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="hidden md:table-cell">Date</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialTransactions.map((transaction) => (
                <TableRow key={transaction.id}>
                  <TableCell className="hidden md:table-cell">{new Date(transaction.date).toLocaleDateString()}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{getAccountName(transaction.accountId)}</TableCell>
                  <TableCell className="font-medium">{transaction.description}</TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                        <Badge variant="outline" className="mb-1 w-fit">{getCategoryName(transaction.categoryId)}</Badge>
                        {transaction.subcategoryId && <span className="text-xs text-muted-foreground">{getSubcategoryName(transaction.subcategoryId)}</span>}
                    </div>
                  </TableCell>
                  <TableCell className={`text-right font-semibold ${transaction.amountBase > 0 ? 'text-green-600' : ''}`}>€{transaction.amountBase.toFixed(2)}</TableCell>
                  <TableCell className="text-right">
                    <div className="hidden md:flex items-center justify-end">
                      <Button variant="ghost" size="icon" onClick={() => handleApprove(transaction.id)}>
                          <Check className="h-4 w-4 text-green-500" />
                          <span className="sr-only">Approve</span>
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setEditingTransaction(transaction)}>
                          <Edit className="h-4 w-4 text-primary" />
                          <span className="sr-only">Edit</span>
                      </Button>
                    </div>
                    <div className="md:hidden">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon">
                                    <MoreVertical className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleApprove(transaction.id)}>
                                    <Check className="mr-2 h-4 w-4 text-green-500" />
                                    Approve
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setEditingTransaction(transaction)}>
                                    <Edit className="mr-2 h-4 w-4 text-primary" />
                                    Edit
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <TransactionFormSheet 
        isOpen={!!editingTransaction}
        onOpenChange={(open) => { if (!open) setEditingTransaction(null) }}
        transaction={editingTransaction}
        onSave={handleSave}
        categories={categories}
        accounts={accounts}
      />
    </>
  );
}

const extractRuleTokenFromDescription = (description: string): string => {
  return description.trim();
};
