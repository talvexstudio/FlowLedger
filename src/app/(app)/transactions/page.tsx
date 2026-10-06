'use client';

import { TransactionsDataTable } from "@/components/transactions/data-table";
import { useFlowLedger } from "@/hooks/use-flow-ledger";
import { TransactionFormSheet } from "@/components/transactions/transaction-form-sheet";
import { useRef, useEffect, useState } from "react";
import type { ClassificationRule, Transaction } from "@/lib/types";
import {
  apiSaveTransaction,
  apiConfirmTransaction,
  apiDeleteTransaction,
  apiPreviewTransactionBulkDelete,
  apiBulkDeleteTransactions,
  apiGetRules,
  apiSaveRule,
} from "@/lib/api";
import {
  applyRulesToTransaction,
  applyRuleClassificationToTransaction,
  ruleMatchesTransactionForBackfill,
} from "@/lib/utils/rule-utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { PlusCircle } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { RuleBackfillPanel } from "@/components/transactions/rule-backfill-panel";


export default function TransactionsPage() {
    const { toast } = useToast();
    const { categories, accounts, reloadTransactions, workspaceId, transactions } = useFlowLedger();
    const [sheetState, setSheetState] = useState<{ open: boolean; transaction: Partial<Transaction> | null }>({ open: false, transaction: null });
    const [deleteState, setDeleteState] = useState<{ open: boolean; transaction: Transaction | null }>({ open: false, transaction: null });
    const [backfillCandidates, setBackfillCandidates] = useState<Transaction[]>([]);
    const [pendingRule, setPendingRule] = useState<(ClassificationRule & { categoryName?: string; subcategoryName?: string }) | null>(null);
    const backfillPanelRef = useRef<HTMLDivElement | null>(null);
    
    const handleNew = () => {
        setSheetState({ open: true, transaction: null });
    }

    const handleEdit = (transaction: Transaction) => {
        setSheetState({ open: true, transaction });
    }

    const handleDelete = (transaction: Transaction) => {
        setDeleteState({ open: true, transaction });
    }

    const handleConfirmDelete = async () => {
        if (!workspaceId || !deleteState.transaction) return;
        try {
            await apiDeleteTransaction(workspaceId, deleteState.transaction.id);
            await reloadTransactions();
            toast({
              title: "Transaction Deleted",
              description: "The transaction has been successfully removed.",
            });
        } catch (error) {
            console.error(error);
            toast({
                variant: 'destructive',
                title: 'Delete failed',
                description: 'Could not delete the transaction.',
            });
        } finally {
            setDeleteState({ open: false, transaction: null });
        }
    };
    
    const handleSave = async (updatedTransaction: Partial<Transaction>, createRule: boolean) => {
      if (!workspaceId) return;
        try {
            const rules = updatedTransaction.id ? [] : await apiGetRules(workspaceId);
            const txToSave = updatedTransaction.id
              ? updatedTransaction
              : applyRulesToTransaction(updatedTransaction, rules);

            const saved = await apiSaveTransaction(workspaceId, txToSave);
            await reloadTransactions();
            toast({
              title: `Transaction ${updatedTransaction.id ? 'Updated' : 'Created'}`,
              description: "Your changes have been saved.",
            });
            if (createRule) {
              const descriptionSource = saved.rawDescription || saved.description || "";
              const descriptionToken = extractRuleTokenFromDescription(descriptionSource);

              if (descriptionToken) {
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
                  (tx) =>
                    tx.id !== saved.id && ruleMatchesTransactionForBackfill(createdRule, tx)
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
            return saved;
        } catch (error) {
            console.error(error);
            toast({
                variant: 'destructive',
                title: 'Save failed',
                description: error instanceof Error ? error.message : 'Could not save transaction changes.',
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
                behavior: "smooth",
            });
        }
    }, [pendingRule, backfillCandidates.length]);

    const handleConfirm = async (transaction: Transaction) => {
        if (!workspaceId || !transaction.id) return;
        try {
            await apiConfirmTransaction(workspaceId, transaction.id);
            await reloadTransactions();
            toast({
                title: 'Transaction Confirmed',
                description: 'The transaction has been confirmed and is no longer under review.',
            });
        } catch (error) {
            console.error(error);
            toast({
                variant: 'destructive',
                title: 'Confirmation failed',
                description: 'Could not confirm the transaction.',
            });
        }
    }

    const handleBulkDeletePreview = async (ids: string[]) => {
        if (!workspaceId || ids.length === 0) return null;
        try {
            return await apiPreviewTransactionBulkDelete(workspaceId, ids);
        } catch (error) {
            console.error(error);
            toast({
                variant: 'destructive',
                title: 'Deletion preview failed',
                description: error instanceof Error ? error.message : 'Could not review the selected transactions.',
            });
            return null;
        }
    }

    const handleBulkDelete = async (ids: string[]) => {
        if (!workspaceId || ids.length === 0) return false;
        try {
            const result = await apiBulkDeleteTransactions(workspaceId, ids);
            await reloadTransactions();
            toast({
              title: 'Transactions Deleted',
              description: `Deleted ${result.deletedTransactions} transaction(s).`,
            });
            return true;
        } catch (error) {
            console.error(error);
            toast({
                variant: 'destructive',
                title: 'Bulk delete failed',
                description: error instanceof Error ? error.message : 'Could not delete the selected transactions.',
            });
            return false;
        }
    }

    const handleExportActivityBackup = async () => {
        try {
            const response = await fetch('/api/data-management/backup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scope: 'activity' }),
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => null) as { error?: string } | null;
                throw new Error(payload?.error ?? 'Could not export the Activity backup.');
            }
            const blob = await response.blob();
            const disposition = response.headers.get('Content-Disposition');
            const filename = disposition?.match(/filename="?([^";]+)"?/i)?.[1]
                ?? 'flowledger-backup-activity.json';
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            toast({ title: 'Activity backup exported', description: 'The backup was downloaded to your device.' });
        } catch (error) {
            toast({
                variant: 'destructive',
                title: 'Backup failed',
                description: error instanceof Error ? error.message : 'Could not export the Activity backup.',
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
    
  return (
    <>
      <div className="space-y-6">
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
        <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Transactions</h1>
              <p className="text-muted-foreground">View and manage all your transactions.</p>
            </div>
             <Button onClick={handleNew}>
              <PlusCircle />
              New Transaction
            </Button>
        </div>
        <div className="mb-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-5 rounded-sm bg-muted" />
            <span>
              Greyed transactions are <span className="font-medium">pending review</span> and are <span className="font-medium">not included</span> in dashboard metrics until confirmed.
            </span>
          </span>
        </div>
        <TransactionsDataTable
          onEdit={handleEdit}
          onConfirm={handleConfirm}
          onDelete={handleDelete}
          onBulkDeletePreview={handleBulkDeletePreview}
          onBulkDelete={handleBulkDelete}
          onExportActivityBackup={handleExportActivityBackup}
        />
      </div>
      <TransactionFormSheet 
        isOpen={sheetState.open}
        onOpenChange={(open) => { if (!open) setSheetState({ open: false, transaction: null }) }}
        transaction={sheetState.transaction}
        onSave={handleSave}
        onResolutionComplete={reloadTransactions}
        categories={categories}
        accounts={accounts}
      />
      <AlertDialog open={deleteState.open} onOpenChange={(open) => { if (!open) setDeleteState({ open: false, transaction: null })}}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this transaction?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the transaction.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const extractRuleTokenFromDescription = (description: string): string => {
  return description.trim();
};
