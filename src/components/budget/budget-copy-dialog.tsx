'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  apiCopyBudgets,
  apiListBudgetCopySources,
  apiPreviewBudgetCopy,
} from '@/lib/api';
import type {
  BudgetCopyMode,
  BudgetCopyPreview,
  BudgetMonthReference,
} from '@/lib/data-management/budget-copy';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const periodKey = ({ year, month }: BudgetMonthReference) => `${year}-${month}`;
const periodLabel = ({ year, month }: BudgetMonthReference) => `${MONTH_NAMES[month - 1]} ${year}`;

export type BudgetCopyDialogRequest = {
  preferredSource?: BudgetMonthReference;
  requirePreferredSource?: boolean;
};

type BudgetCopyDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  target: BudgetMonthReference;
  request?: BudgetCopyDialogRequest;
  onCopied: () => Promise<void> | void;
};

export function BudgetCopyDialog({
  open,
  onOpenChange,
  workspaceId,
  target,
  request,
  onCopied,
}: BudgetCopyDialogProps) {
  const { toast } = useToast();
  const [sources, setSources] = useState<BudgetMonthReference[]>([]);
  const [sourceKey, setSourceKey] = useState('');
  const [mode, setMode] = useState<BudgetCopyMode>('fill_empty');
  const [preview, setPreview] = useState<BudgetCopyPreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCopying, setIsCopying] = useState(false);

  const selectedSource = useMemo(
    () => sources.find((source) => periodKey(source) === sourceKey),
    [sources, sourceKey]
  );

  useEffect(() => {
    if (!open || !workspaceId) return;
    let active = true;
    setMode('fill_empty');
    setPreview(null);
    setIsLoading(true);
    apiListBudgetCopySources(workspaceId)
      .then(({ sources: availableSources }) => {
        if (!active) return;
        const usable = availableSources.filter((source) => (
          source.year !== target.year || source.month !== target.month
        ));
        setSources(usable);
        const preferred = request?.preferredSource
          ? usable.find((source) => periodKey(source) === periodKey(request.preferredSource!))
          : undefined;
        if (request?.requirePreferredSource && !preferred) {
          toast({
            title: 'No previous-month budgets',
            description: `${periodLabel(request.preferredSource!)} has no budgets to copy.`,
          });
          onOpenChange(false);
          return;
        }
        setSourceKey(periodKey(preferred ?? usable[0] ?? { year: 0, month: 0 }));
      })
      .catch((error) => {
        if (!active) return;
        toast({ title: 'Could not load budget months', description: (error as Error).message, variant: 'destructive' });
      })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [open, workspaceId, target.year, target.month, request, onOpenChange, toast]);

  useEffect(() => {
    if (!open || !selectedSource) {
      setPreview(null);
      return;
    }
    let active = true;
    setIsLoading(true);
    apiPreviewBudgetCopy({
      workspaceId,
      sourceYear: selectedSource.year,
      sourceMonth: selectedSource.month,
      targetYear: target.year,
      targetMonth: target.month,
      mode,
    })
      .then((nextPreview) => { if (active) setPreview(nextPreview); })
      .catch((error) => {
        if (!active) return;
        setPreview(null);
        toast({ title: 'Could not preview budget copy', description: (error as Error).message, variant: 'destructive' });
      })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [open, selectedSource, mode, workspaceId, target.year, target.month, toast]);

  const handleCopy = async () => {
    if (!selectedSource || !preview) return;
    setIsCopying(true);
    try {
      const result = await apiCopyBudgets({
        workspaceId,
        sourceYear: selectedSource.year,
        sourceMonth: selectedSource.month,
        targetYear: target.year,
        targetMonth: target.month,
        mode,
      });
      await onCopied();
      toast({
        title: 'Budgets copied',
        description: `${result.budgetsToCopy} budget${result.budgetsToCopy === 1 ? '' : 's'} copied to ${periodLabel(target)}.`,
      });
      onOpenChange(false);
    } catch (error) {
      toast({ title: 'Copy failed', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setIsCopying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy budgets</DialogTitle>
          <DialogDescription>
            Copy a monthly plan into {periodLabel(target)}. Actual spending is never copied.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Source month</label>
            <Select value={sourceKey} onValueChange={setSourceKey} disabled={isLoading || sources.length === 0}>
              <SelectTrigger><SelectValue placeholder="Choose a month" /></SelectTrigger>
              <SelectContent>
                {sources.map((source) => (
                  <SelectItem key={periodKey(source)} value={periodKey(source)}>{periodLabel(source)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Copy mode</label>
            <Select value={mode} onValueChange={(value) => setMode(value as BudgetCopyMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fill_empty">Fill empty categories only</SelectItem>
                <SelectItem value="replace">Replace existing budgets</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {sources.length === 0 && !isLoading ? (
            <p className="rounded-md border p-3 text-sm text-muted-foreground">
              No other month has budgets available to copy.
            </p>
          ) : null}

          {preview ? (
            <div className="space-y-1 rounded-md border p-3 text-sm">
              <p><span className="text-muted-foreground">Source:</span> {periodLabel(selectedSource!)}</p>
              <p><span className="text-muted-foreground">Target:</span> {periodLabel(target)}</p>
              <p><span className="text-muted-foreground">Mode:</span> {mode === 'fill_empty' ? 'Fill empty categories only' : 'Replace existing budgets'}</p>
              <p><span className="text-muted-foreground">Budgets to copy:</span> {preview.budgetsToCopy}</p>
              {mode === 'fill_empty' ? (
                <p><span className="text-muted-foreground">Existing target budgets preserved:</span> {preview.existingTargetBudgetsPreserved}</p>
              ) : (
                <p className="font-medium text-destructive">
                  The target plan will be replaced. {preview.targetBudgetsRemoved} target budget{preview.targetBudgetsRemoved === 1 ? '' : 's'} not present in the source will be removed.
                </p>
              )}
              {preview.skippedSourceBudgets > 0 ? (
                <p className="text-muted-foreground">Skipped unavailable or non-budgetable categories: {preview.skippedSourceBudgets}</p>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isCopying}>Cancel</Button>
          <Button type="button" onClick={handleCopy} disabled={!preview || isLoading || isCopying}>
            {isCopying ? 'Copying…' : 'Copy budgets'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
