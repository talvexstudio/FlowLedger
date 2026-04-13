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

interface ImportResultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
  pending: number;
  duplicates?: number;
  onReviewNow: () => void;
}

export function ImportResultDialog({
  open,
  onOpenChange,
  total,
  pending,
  duplicates = 0,
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
          <AlertDialogTitle>Import completed</AlertDialogTitle>
          <AlertDialogDescription>
            {pending === 0 ? (
              <>Imported {total} transaction(s). All of them were classified by your existing rules.</>
            ) : (
              <>
                Imported {total} transaction(s). <strong>{pending}</strong> still need classification.
                <br />
                These unclassified transactions are not yet included in your dashboard or budget until you review and confirm their categories.
              </>
            )}
            {duplicates > 0 && (
              <>
                <br />
                <strong>{duplicates}</strong> potential duplicate(s) were flagged for review.
              </>
            )}
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
