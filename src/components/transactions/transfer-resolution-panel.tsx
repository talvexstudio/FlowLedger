'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Account, Transaction, TransferCounterpartCandidate } from '@/lib/types';
import {
  apiCreateCounterpartForExisting,
  apiGetTransferCounterpartCandidates,
  apiLinkExistingTransferPair,
} from '@/lib/api';

type TransferResolutionPanelProps = {
  transaction: Transaction;
  accounts: Account[];
  onComplete: () => Promise<void> | void;
  onKeepUnpaired: () => void;
};

const formatAmount = (amount: number) => new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
}).format(amount);

export function TransferResolutionPanel({
  transaction,
  accounts,
  onComplete,
  onKeepUnpaired,
}: TransferResolutionPanelProps) {
  const [candidates, setCandidates] = useState<TransferCounterpartCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [confirmCreateAnyway, setConfirmCreateAnyway] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCandidates = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await apiGetTransferCounterpartCandidates(
        transaction.workspaceId,
        transaction.id
      );
      setCandidates(result);
      return result;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not search for matching transactions.');
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [transaction.id, transaction.workspaceId]);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  const handleLink = async (candidateId: string) => {
    setPendingAction(candidateId);
    setError(null);
    try {
      await apiLinkExistingTransferPair(transaction.workspaceId, transaction.id, candidateId);
      await onComplete();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not link the transactions.');
      await loadCandidates();
    } finally {
      setPendingAction(null);
    }
  };

  const handleCreate = async (allowCandidateOverride: boolean) => {
    setPendingAction('create');
    setError(null);
    try {
      await apiCreateCounterpartForExisting(
        transaction.workspaceId,
        transaction.id,
        allowCandidateOverride
      );
      await onComplete();
    } catch (requestError) {
      const refreshed = await loadCandidates();
      if (refreshed.length > 0) setConfirmCreateAnyway(true);
      setError(requestError instanceof Error ? requestError.message : 'Could not create the counterpart transaction.');
    } finally {
      setPendingAction(null);
    }
  };

  const counterpartName = accounts.find(
    (account) => account.id === transaction.destinationAccountId
  )?.name ?? 'the counterpart account';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <div>
          <h3 className="text-base font-semibold uppercase tracking-wide">Transfer resolution</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            The transfer was saved. Choose whether to link it, create its reciprocal movement, or keep it unpaired.
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Transfer resolution failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Searching {counterpartName} for possible matches…</p>
        ) : candidates.length > 0 ? (
          <div className="space-y-3">
            <div>
              <h4 className="font-medium">Possible matching transaction(s)</h4>
              <p className="text-sm text-muted-foreground">
                Review every candidate. FlowLedger will not choose one automatically.
              </p>
            </div>
            {candidates.map(({ transaction: candidate, calendarDayDifference }) => (
              <div key={candidate.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{candidate.description}</div>
                    <div className="text-muted-foreground">
                      {new Date(candidate.date).toLocaleDateString()} ·{' '}
                      {accounts.find((account) => account.id === candidate.accountId)?.name ?? 'Unknown account'}
                    </div>
                  </div>
                  <div className="text-right font-semibold">{formatAmount(candidate.amountBase)}</div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{candidate.type}</Badge>
                  <Badge variant="outline">{candidate.needsReview ? 'Pending review' : 'Confirmed'}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {calendarDayDifference === 0 ? 'Same date' : '1 day apart'}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    className="ml-auto"
                    disabled={pendingAction !== null}
                    onClick={() => void handleLink(candidate.id)}
                  >
                    {pendingAction === candidate.id ? 'Linking…' : 'Link existing'}
                  </Button>
                </div>
              </div>
            ))}

            {confirmCreateAnyway ? (
              <Alert>
                <AlertTitle>Possible matching transaction already exists in {counterpartName}</AlertTitle>
                <AlertDescription className="space-y-3">
                  <p>Create another counterpart anyway?</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={pendingAction !== null}
                      onClick={() => void handleCreate(true)}
                    >
                      {pendingAction === 'create' ? 'Creating…' : 'Create another counterpart anyway'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pendingAction !== null}
                      onClick={() => setConfirmCreateAnyway(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled={pendingAction !== null}
                onClick={() => setConfirmCreateAnyway(true)}
              >
                Create counterpart anyway
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3 rounded-md border p-4">
            <p className="text-sm text-muted-foreground">
              No plausible opposite movement was found in {counterpartName}.
            </p>
            <Button
              type="button"
              disabled={pendingAction !== null}
              onClick={() => void handleCreate(false)}
            >
              {pendingAction === 'create' ? 'Creating…' : 'Create counterpart'}
            </Button>
          </div>
        )}
      </div>

      <div className="mt-6 flex shrink-0 justify-end border-t bg-white pt-4">
        <Button type="button" variant="outline" disabled={pendingAction !== null} onClick={onKeepUnpaired}>
          Keep unpaired
        </Button>
      </div>
    </div>
  );
}
