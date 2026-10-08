'use client';

import * as React from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { Account, ClassificationRule, Transaction } from '@/lib/types';
import type { TransferBackfillDecision } from '@/lib/rule-backfill';

interface RuleBackfillPanelProps {
  rule: ClassificationRule & { categoryName?: string; subcategoryName?: string };
  transactions: Transaction[];
  accounts: Account[];
  onApply: (selectedIds: string[], transferDecision?: TransferBackfillDecision) => void;
  onCancel: () => void;
}

export function RuleBackfillPanel({
  rule,
  transactions,
  accounts,
  onApply,
  onCancel,
}: RuleBackfillPanelProps) {
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [transferDecision, setTransferDecision] = React.useState<TransferBackfillDecision | undefined>();

  React.useEffect(() => {
    setSelectedIds(transactions.map((t) => t.id));
    setTransferDecision(undefined);
  }, [transactions]);

  const toggleId = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]
    );
  };

  const handleApply = () => {
    onApply(selectedIds, transferDecision);
  };

  if (transactions.length === 0) return null;
  const isTransferRule = rule.action.type === 'InternalTransfer';
  const sourceAccountName = accounts.find((account) => account.id === rule.match.accountId)?.name ?? 'Unknown account';
  const counterpartName = accounts.find(
    (account) => account.id === rule.action.destinationAccountId
  )?.name ?? 'Unknown account';

  return (
    <div className="mb-4 rounded-lg border border-primary/30 bg-muted/40 p-4 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">Apply this rule to similar transactions?</h3>
          <p className="mb-1 text-xs text-muted-foreground">
            We found {transactions.length} transaction(s) with similar descriptions. Select which ones
            should receive the same classification.
          </p>
          <p className="text-xs">
            <span className="font-medium">Rule:</span>{' '}
            {rule.match.descriptionContains ? (
              <>
                Description {rule.match.matchMode === 'starts_with' ? 'starts with' : 'contains'}{' '}
                <span className="font-mono">&quot;{rule.match.descriptionContains}&quot;</span>
              </>
            ) : (
              'Description-based rule'
            )}
            {rule.categoryName && (
              <>
                {' · '}<span className="font-medium">Category:</span> {rule.categoryName}
              </>
            )}
            {rule.subcategoryName && (
              <>
                {' / '}
                <span className="font-medium">Subcategory:</span> {rule.subcategoryName}
              </>
            )}
            {rule.action?.type && (
              <>
                {' · '}<span className="font-medium">Type:</span> {rule.action.type}
              </>
            )}
          </p>
        </div>
      </div>

      {isTransferRule && (
        <div className="mt-3 space-y-3 rounded-md border bg-background p-3">
          <div className="text-sm">
            <p className="font-medium">{sourceAccountName} → {counterpartName}</p>
            <p className="text-xs text-muted-foreground">
              Direction: {rule.action.internalDirection?.toUpperCase() ?? 'not set'}
            </p>
          </div>
          <RadioGroup
            value={transferDecision}
            onValueChange={(value) => setTransferDecision(value as TransferBackfillDecision)}
          >
            <div className="flex items-start gap-2">
              <RadioGroupItem value="create_counterparts" id="create-counterparts" className="mt-0.5" />
              <Label htmlFor="create-counterparts" className="font-normal">
                <span className="block font-medium">Create reciprocal counterpart transactions</span>
                <span className="text-xs text-muted-foreground">
                  Existing unambiguous reciprocal movements are linked instead of duplicated.
                </span>
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="keep_unpaired" id="keep-unpaired" className="mt-0.5" />
              <Label htmlFor="keep-unpaired" className="font-normal">
                <span className="block font-medium">Keep source transactions unpaired for review</span>
                <span className="text-xs text-muted-foreground">
                  No reciprocal transaction will be created.
                </span>
              </Label>
            </div>
          </RadioGroup>
        </div>
      )}

      <div className="mt-3 max-h-72 overflow-y-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr>
              <th className="p-2 text-left">Select</th>
              <th className="p-2 text-left">Date</th>
              <th className="p-2 text-left">Description</th>
              <th className="p-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              <tr key={tx.id} className="border-t">
                <td className="p-2 align-middle">
                  <Checkbox
                    checked={selectedIds.includes(tx.id)}
                    onCheckedChange={() => toggleId(tx.id)}
                  />
                </td>
                <td className="p-2 align-middle">
                  {tx.date ? format(new Date(tx.date), 'yyyy-MM-dd') : ''}
                </td>
                <td className="max-w-[260px] truncate p-2 align-middle">{tx.description}</td>
                <td className="p-2 align-middle text-right">{tx.amountBase?.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleApply}
          disabled={selectedIds.length === 0 || (isTransferRule && !transferDecision)}
        >
          Apply to selected ({selectedIds.length})
        </Button>
      </div>
    </div>
  );
}
