"use client";

import * as React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ImportRejectedRow } from "@/lib/import-processing";

interface ImportResultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
  accepted: number;
  pending: number;
  duplicates?: number;
  rejectedRows?: ImportRejectedRow[];
  onReviewNow: () => void;
}

export function ImportResultDialog({
  open,
  onOpenChange,
  total,
  accepted,
  pending,
  duplicates = 0,
  rejectedRows = [],
  onReviewNow,
}: ImportResultDialogProps) {
  const handleReviewNow = () => {
    onReviewNow();
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Import results</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                Processed {total} row(s): <strong>{accepted}</strong> imported and{' '}
                <strong>{rejectedRows.length}</strong> rejected.
              </p>
              {pending > 0 && (
                <p>
                  <strong>{pending}</strong> imported transaction(s) need review and are not included
                  in dashboard, budget, or account balances until confirmed.
                </p>
              )}
            {duplicates > 0 && (
              <p>
                <strong>{duplicates}</strong> potential duplicate(s) were flagged for review.
              </p>
            )}
              {rejectedRows.length > 0 && (
                <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-3 text-left text-xs">
                  {rejectedRows.map((row, index) => (
                    <div key={`${row.rowNumber}-${index}`} className="space-y-1">
                      <p className="font-medium text-foreground">Row {row.rowNumber}: {row.reason}</p>
                      <pre className="whitespace-pre-wrap break-words text-muted-foreground">
                        {JSON.stringify(row.sourceValues)}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {pending > 0 ? (
          <AlertDialogFooter>
            <AlertDialogCancel>Later</AlertDialogCancel>
            <AlertDialogAction onClick={handleReviewNow}>
              Review now
            </AlertDialogAction>
          </AlertDialogFooter>
        ) : (
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => onOpenChange(false)}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
