'use client';

import * as React from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiSaveRule } from '@/lib/api';
import { createRuleDraftFromTransaction, ruleDataFromDraft, validateRuleDraft } from '@/lib/rule-draft';
import type { Account, Category, ClassificationRule, Subcategory, Transaction } from '@/lib/types';
import { getRuleBackfillCandidates } from '@/lib/utils/rule-utils';

type RuleCreationDialogProps = {
  transaction: Transaction | null;
  workspaceId: string | null;
  accounts: Account[];
  categories: (Category & { subcategories: Subcategory[] })[];
  transactions: Transaction[];
  onOpenChange: (open: boolean) => void;
  onCreated: (rule: ClassificationRule, candidates: Transaction[]) => void;
};

export function RuleCreationDialog({
  transaction,
  workspaceId,
  accounts,
  categories,
  transactions,
  onOpenChange,
  onCreated,
}: RuleCreationDialogProps) {
  const initialDraft = React.useMemo(
    () => transaction ? createRuleDraftFromTransaction(transaction) : null,
    [transaction]
  );
  const [descriptionContains, setDescriptionContains] = React.useState('');
  const [matchMode, setMatchMode] = React.useState<'contains' | 'starts_with'>('contains');
  const [internalDirection, setInternalDirection] = React.useState<'In' | 'Out' | undefined>();
  const [destinationAccountId, setDestinationAccountId] = React.useState<string | undefined>();
  const [error, setError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
    setDescriptionContains(initialDraft?.descriptionContains ?? '');
    setMatchMode(initialDraft?.matchMode ?? 'contains');
    setInternalDirection(initialDraft?.action.internalDirection);
    setDestinationAccountId(initialDraft?.action.destinationAccountId);
    setError(null);
  }, [initialDraft]);

  if (!transaction || !initialDraft) return null;

  const accountName = accounts.find((account) => account.id === transaction.accountId)?.name ?? 'Unknown account';
  const category = categories.find((candidate) => candidate.id === transaction.categoryId);
  const subcategory = category?.subcategories.find(
    (candidate) => candidate.id === transaction.subcategoryId
  );
  const isTransfer = transaction.type === 'InternalTransfer';
  const counterpartAccounts = accounts.filter(
    (account) => account.workspaceId === workspaceId && account.id !== transaction.accountId
  );

  const handleSave = async () => {
    if (!workspaceId) return;
    setIsSaving(true);
    setError(null);
    try {
      const draft = {
        ...initialDraft,
        descriptionContains,
        matchMode,
        action: isTransfer
          ? {
              type: 'InternalTransfer' as const,
              internalDirection,
              destinationAccountId,
            }
          : initialDraft.action,
      };
      validateRuleDraft(draft, workspaceId, accounts);
      const created = await apiSaveRule(
        workspaceId,
        ruleDataFromDraft(draft, transaction.id, workspaceId)
      );
      onCreated(
        created,
        getRuleBackfillCandidates(created, transactions, transaction.id)
      );
      onOpenChange(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not create the rule.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Review classification rule</DialogTitle>
          <DialogDescription>
            FlowLedger suggested a stable description pattern. Review or edit it before saving.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1">
            <Label>Original</Label>
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              {initialDraft.originalDescription}
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="rule-description-pattern">Description</Label>
            <div className="flex gap-2">
              <Select
                value={matchMode}
                onValueChange={(value) => setMatchMode(value as 'contains' | 'starts_with')}
              >
                <SelectTrigger className="w-[145px] shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contains">Contains</SelectItem>
                  <SelectItem value="starts_with">Starts with</SelectItem>
                </SelectContent>
              </Select>
              <Input
                id="rule-description-pattern"
                value={descriptionContains}
                onChange={(event) => setDescriptionContains(event.target.value)}
                autoFocus
              />
            </div>
            <p className="text-xs text-muted-foreground">
              This is editable. Short explicit patterns such as LEV are allowed.
            </p>
          </div>
          <div className="grid gap-3 rounded-md border p-3 text-sm sm:grid-cols-2">
            <div>
              <span className="text-muted-foreground">Account</span>
              <p className="font-medium">{accountName}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Resulting type</span>
              <p className="font-medium">{transaction.type === 'InternalTransfer' ? 'Internal Transfer' : transaction.type}</p>
            </div>
            {!isTransfer && (
              <>
                <div>
                  <span className="text-muted-foreground">Category</span>
                  <p className="font-medium">{category?.name ?? 'None'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Subcategory</span>
                  <p className="font-medium">{subcategory?.name ?? 'None'}</p>
                </div>
              </>
            )}
          </div>

          {isTransfer && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Direction</Label>
                <Select
                  value={internalDirection}
                  onValueChange={(value) => setInternalDirection(value as 'In' | 'Out')}
                >
                  <SelectTrigger><SelectValue placeholder="Choose direction" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Out">OUT</SelectItem>
                    <SelectItem value="In">IN</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Counterpart account</Label>
                <Select value={destinationAccountId} onValueChange={setDestinationAccountId}>
                  <SelectTrigger><SelectValue placeholder="Choose account" /></SelectTrigger>
                  <SelectContent>
                    {counterpartAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={isSaving || !descriptionContains.trim()}>
            {isSaving ? 'Saving…' : 'Save rule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
