'use client';

import { Loader2, TriangleAlert } from 'lucide-react';
import type { Account } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type AccountDeleteDialogProps = {
  account: Account | null;
  deleting: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

export function AccountDeleteDialog({
  account,
  deleting,
  onOpenChange,
  onConfirm,
}: AccountDeleteDialogProps) {
  return (
    <AlertDialog
      open={account !== null}
      onOpenChange={(open) => {
        if (!deleting) onOpenChange(open);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center">
            <TriangleAlert className="mr-2 text-destructive" />
            Delete account?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete the account “{account?.name}”? This action cannot be undone.
            Accounts with existing transactions or other references cannot be deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={deleting}>
            {deleting && <Loader2 className="animate-spin" />}
            {deleting ? 'Deleting…' : 'Delete account'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
