'use client';

import { useState, type MouseEvent } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useFlowLedger } from '@/hooks/use-flow-ledger';
import { useToast } from '@/hooks/use-toast';
import { apiDeleteTransaction } from '@/lib/api';
import { deleteTransactionAndReload } from '@/lib/transaction-delete-client';
import type { Transaction } from '@/lib/types';

type TransactionDeleteDialogProps = {
  transaction: Transaction | null;
  onOpenChange: (open: boolean) => void;
};

export function TransactionDeleteDialog({
  transaction,
  onOpenChange,
}: TransactionDeleteDialogProps) {
  const { workspaceId, reloadTransactions } = useFlowLedger();
  const { toast } = useToast();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!workspaceId || !transaction || isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteTransactionAndReload(workspaceId, transaction.id, {
        deleteTransaction: apiDeleteTransaction,
        reloadTransactions,
      });
      toast({
        title: 'Transaction Deleted',
        description: 'The transaction has been successfully removed.',
      });
      setIsDeleting(false);
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast({
        variant: 'destructive',
        title: 'Delete failed',
        description: error instanceof Error
          ? error.message
          : 'Could not delete the transaction.',
      });
      setIsDeleting(false);
    }
  };

  return (
    <AlertDialog
      open={transaction !== null}
      onOpenChange={(open) => {
        if (!open && isDeleting) return;
        onOpenChange(open);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this transaction?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete the transaction.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isDeleting}
            className="bg-destructive hover:bg-destructive/90"
          >
            {isDeleting ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
