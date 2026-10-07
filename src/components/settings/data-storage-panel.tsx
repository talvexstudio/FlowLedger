'use client';

import { useState, type ChangeEvent } from 'react';
import { AlertTriangle, Download, Loader2, RotateCcw, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { ImportHistoryPanel } from '@/components/settings/import-history-panel';
import { useToast } from '@/hooks/use-toast';
import type { DataResetOperation, DataResetPreview } from '@/lib/data-management/data-reset';
import {
  CLEAR_RESET_SECTION_DESCRIPTION,
  CLEAR_RESET_SECTION_TITLE,
  formatCount,
  RESET_OPTIONS,
} from '@/lib/data-management/ui-copy';
import type { RestorePreview } from '@/lib/data-management/restore-validation';
import {
  BACKUP_SCOPES,
  DATA_SCOPE_DEFINITIONS,
  type BackupScope,
  type PersistedStoreKey,
} from '@/lib/data-management/store-manifest';

type RestoreApiError = { error?: { code?: string; message?: string } };

const fallbackFilename = (scope: BackupScope) =>
  `flowledger-backup-${scope.replace(/_/g, '-')}.json`;

const responseFilename = (header: string | null, scope: BackupScope) => {
  const match = header?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? fallbackFilename(scope);
};

const STORE_LABELS: Record<PersistedStoreKey, string> = {
  workspaces: 'Workspaces',
  accounts: 'Accounts',
  categories: 'Categories',
  imports: 'Imports',
  importTemplates: 'Import templates',
  budgets: 'Budgets',
  rules: 'Rules',
  transactions: 'Transactions',
};

export function DataStoragePanel() {
  const [scope, setScope] = useState<BackupScope>('activity');
  const [exporting, setExporting] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [resetPreview, setResetPreview] = useState<DataResetPreview | null>(null);
  const [resetPreviewing, setResetPreviewing] = useState<DataResetOperation | null>(null);
  const [resetConfirmed, setResetConfirmed] = useState(false);
  const [resetting, setResetting] = useState(false);
  const { toast } = useToast();

  const exportBackup = async (backupScope: BackupScope) => {
    setExporting(true);
    try {
      const response = await fetch('/api/data-management/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: backupScope }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? 'Could not export the backup.');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = responseFilename(response.headers.get('Content-Disposition'), backupScope);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      toast({ title: 'Backup exported', description: 'The backup was downloaded to your device.' });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Backup failed',
        description: error instanceof Error ? error.message : 'Could not export the backup.',
      });
    } finally {
      setExporting(false);
    }
  };

  const previewFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setRestoreFile(file);
    setPreview(null);
    setConfirmed(false);
    if (!file) return;

    setPreviewing(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/data-management/restore/preview', {
        method: 'POST',
        body: formData,
      });
      const payload = await response.json() as { preview?: RestorePreview } & RestoreApiError;
      if (!response.ok || !payload.preview) {
        throw new Error(payload.error?.message ?? 'The backup could not be validated.');
      }
      setPreview(payload.preview);
      toast({ title: 'Backup validated', description: 'Review the replacement impact before restoring.' });
    } catch (error) {
      setRestoreFile(null);
      toast({
        variant: 'destructive',
        title: 'Invalid backup',
        description: error instanceof Error ? error.message : 'The backup could not be validated.',
      });
    } finally {
      setPreviewing(false);
    }
  };

  const replaceCurrentData = async () => {
    if (!restoreFile || !preview || !confirmed) return;
    setRestoring(true);
    try {
      const formData = new FormData();
      formData.append('file', restoreFile);
      formData.append('confirmReplaceAll', 'true');
      const response = await fetch('/api/data-management/restore', {
        method: 'POST',
        body: formData,
      });
      const payload = await response.json() as { result?: { cleanupWarning?: string } } & RestoreApiError;
      if (!response.ok || !payload.result) {
        throw new Error(payload.error?.message ?? 'The backup could not be restored.');
      }
      toast({
        title: 'Restore complete',
        description: payload.result.cleanupWarning ?? 'FlowLedger data was replaced successfully.',
      });
      window.location.reload();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Restore failed',
        description: error instanceof Error ? error.message : 'The backup could not be restored.',
      });
      setRestoring(false);
    }
  };

  const reviewResetImpact = async (operation: DataResetOperation) => {
    setResetPreview(null);
    setResetConfirmed(false);
    setResetPreviewing(operation);
    try {
      const response = await fetch('/api/data-management/reset/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation }),
      });
      const payload = await response.json() as { preview?: DataResetPreview } & RestoreApiError;
      if (!response.ok || !payload.preview) {
        throw new Error(payload.error?.message ?? 'The data impact could not be calculated.');
      }
      setResetPreview(payload.preview);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Impact review failed',
        description: error instanceof Error ? error.message : 'The data impact could not be calculated.',
      });
    } finally {
      setResetPreviewing(null);
    }
  };

  const executeReset = async () => {
    if (!resetPreview || !resetConfirmed) return;
    setResetting(true);
    try {
      const response = await fetch('/api/data-management/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: resetPreview.operation, confirmed: true }),
      });
      const payload = await response.json() as { result?: { cleanupWarning?: string } } & RestoreApiError;
      if (!response.ok || !payload.result) {
        throw new Error(payload.error?.message ?? 'The data operation could not be completed.');
      }
      toast({
        title: `${RESET_OPTIONS[resetPreview.operation].title} complete`,
        description: payload.result.cleanupWarning ?? 'FlowLedger data was updated successfully.',
      });
      window.location.reload();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Data operation failed',
        description: error instanceof Error ? error.message : 'The data operation could not be completed.',
      });
      setResetting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data &amp; Storage</CardTitle>
        <CardDescription>Export or replace your local FlowLedger data.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        <section className="space-y-4">
          <div>
            <h3 className="font-medium">Backup</h3>
            <p className="text-sm text-muted-foreground">Choose what to include:</p>
          </div>
          <RadioGroup value={scope} onValueChange={(value) => setScope(value as BackupScope)}>
            {BACKUP_SCOPES.map((backupScope) => {
              const definition = DATA_SCOPE_DEFINITIONS[backupScope];
              return (
                <div key={backupScope} className="flex items-start gap-3 rounded-md border p-4">
                  <RadioGroupItem value={backupScope} id={`backup-${backupScope}`} className="mt-0.5" />
                  <Label htmlFor={`backup-${backupScope}`} className="cursor-pointer space-y-1 font-normal">
                    <span className="block font-medium">{definition.label}</span>
                    <span className="block text-sm text-muted-foreground">{definition.description}</span>
                  </Label>
                </div>
              );
            })}
          </RadioGroup>

          <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            Backups contain sensitive financial information and remain on your device unless you move or upload them.
          </p>

          <Button onClick={() => exportBackup(scope)} disabled={exporting || restoring || resetting}>
            {exporting ? <Loader2 className="animate-spin" /> : <Download />}
            {exporting ? 'Exporting...' : 'Export backup'}
          </Button>
        </section>

        <Separator />

        <section className="space-y-4">
          <div>
            <h3 className="font-medium">Restore backup</h3>
            <p className="text-sm text-muted-foreground">
              Validate a backup, review its impact, then replace all current data.
            </p>
          </div>

          <Label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">
            {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {previewing ? 'Validating...' : 'Choose backup file'}
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={previewFile}
              disabled={previewing || restoring || resetting}
            />
          </Label>
          {restoreFile && <p className="text-sm text-muted-foreground">Selected: {restoreFile.name}</p>}

          {preview && (
            <div className="space-y-5 rounded-md border p-4">
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <div><span className="text-muted-foreground">Backup date</span><p className="font-medium">{new Date(preview.createdAt).toLocaleString()}</p></div>
                <div><span className="text-muted-foreground">FlowLedger version</span><p className="font-medium">{preview.flowLedgerVersion}</p></div>
                <div><span className="text-muted-foreground">Scope</span><p className="font-medium">{preview.scopeLabel}</p></div>
              </div>

              <div>
                <h4 className="mb-2 text-sm font-medium">Backup contents</h4>
                <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  {preview.includedStores.map((key) => (
                    <div key={key} className="flex justify-between rounded bg-muted px-3 py-2">
                      <span>{STORE_LABELS[key]}</span><span className="font-medium">{preview.counts[key]}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
                <div className="mb-2 flex items-center gap-2 font-medium text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  {preview.scope === 'activity' && 'Restore Activity'}
                  {preview.scope === 'financial_data' && 'Restore Financial Data'}
                  {preview.scope === 'everything' && 'Restore Everything'}
                  {preview.scope === 'financial_activity' && 'Restore legacy backup'}
                </div>
                {preview.scope === 'activity' && (
                  <div className="space-y-2">
                    <p>Transactions and import history will be replaced.</p>
                    <p>Accounts, categories, import templates, budgets, rules, and workspaces will be preserved.</p>
                  </div>
                )}
                {preview.scope === 'financial_data' && (
                  <div className="space-y-2">
                    <p>Financial data and configuration will be replaced.</p>
                    <p>Workspaces will be preserved.</p>
                  </div>
                )}
                {preview.scope === 'everything' && <p>All FlowLedger persisted data will be replaced.</p>}
                {preview.scope === 'financial_activity' && (
                  <div className="space-y-2">
                    <p>This legacy backup will replace workspaces, accounts, categories, imports, and transactions.</p>
                    <p>Import templates, budgets, and rules will be cleared.</p>
                  </div>
                )}
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={() => exportBackup('everything')}
                disabled={exporting || restoring || resetting}
              >
                <Download /> Export Everything backup first
              </Button>

              <div className="flex items-start gap-3">
                <Checkbox
                  id="confirm-restore"
                  checked={confirmed}
                  onCheckedChange={(value) => setConfirmed(value === true)}
                  disabled={restoring}
                />
                <Label htmlFor="confirm-restore" className="font-normal leading-5">
                  {preview.scope === 'activity' && 'I understand that the current Activity data will be replaced and cannot be merged.'}
                  {preview.scope === 'financial_data' && 'I understand that the current Financial Data will be replaced and cannot be merged.'}
                  {preview.scope === 'everything' && 'I understand that all current FlowLedger data will be replaced and cannot be merged.'}
                  {preview.scope === 'financial_activity' && "I understand that the legacy backup's defined data scope will be replaced and cannot be merged."}
                </Label>
              </div>

              <Button
                variant="destructive"
                onClick={replaceCurrentData}
                disabled={!confirmed || restoring || exporting}
              >
                {restoring ? <Loader2 className="animate-spin" /> : <Upload />}
                {restoring ? 'Restoring...' : 'Replace current data'}
              </Button>
            </div>
          )}
        </section>

        <Separator />

        <section className="space-y-4">
          <div>
            <h3 className="font-medium">{CLEAR_RESET_SECTION_TITLE}</h3>
            <p className="text-sm text-muted-foreground">{CLEAR_RESET_SECTION_DESCRIPTION}</p>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {(Object.keys(RESET_OPTIONS) as DataResetOperation[]).map((operation) => {
              const option = RESET_OPTIONS[operation];
              const isPreviewing = resetPreviewing === operation;
              return (
                <div key={operation} className="flex flex-col gap-4 rounded-md border p-4">
                  <div className="space-y-1">
                    <h4 className="font-medium">{option.title}</h4>
                    <p className="text-sm text-muted-foreground">{option.description}</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-auto"
                    onClick={() => reviewResetImpact(operation)}
                    disabled={resetPreviewing !== null || resetting || restoring}
                  >
                    {isPreviewing ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                    {isPreviewing ? 'Reviewing...' : 'Review impact'}
                  </Button>
                </div>
              );
            })}
          </div>

          {resetPreview && (
            <div className="space-y-5 rounded-md border border-destructive/40 bg-destructive/5 p-4">
              <div className="flex items-center gap-2 font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" /> {RESET_OPTIONS[resetPreview.operation].title}
              </div>

              <div className="space-y-2 text-sm">
                {resetPreview.operation === 'clear_activity' && (
                  <>
                    <p><strong>{formatCount(resetPreview.currentCounts.transactions, 'transaction')}</strong> will be removed.</p>
                    <p><strong>{formatCount(resetPreview.currentCounts.imports, 'import')}</strong> will be removed.</p>
                    <p>Accounts, categories, import templates, budgets, rules, and workspaces will be preserved.</p>
                  </>
                )}
                {resetPreview.operation === 'reset_financial' && (
                  <>
                    <p>{formatCount(resetPreview.currentCounts.accounts, 'account')}, {formatCount(resetPreview.currentCounts.transactions, 'transaction')}, and {formatCount(resetPreview.currentCounts.imports, 'import')} will be removed.</p>
                    <p>{formatCount(resetPreview.currentCounts.importTemplates, 'import template')}, {formatCount(resetPreview.currentCounts.budgets, 'budget record')}, and {formatCount(resetPreview.currentCounts.rules, 'rule')} will be removed.</p>
                    <p>{formatCount(resetPreview.customCategoryCount, 'custom category', 'custom categories')} and {formatCount(resetPreview.customSubcategoryCount, 'custom subcategory', 'custom subcategories')} will be removed; starter categories will be restored.</p>
                    <p>{formatCount(resetPreview.currentCounts.workspaces, 'workspace')} will be preserved.</p>
                  </>
                )}
                {resetPreview.operation === 'factory_reset' && (
                  <>
                    <p>{formatCount(resetPreview.currentCounts.workspaces, 'workspace')} will be replaced by 1 default workspace.</p>
                    <p>{formatCount(resetPreview.currentCounts.accounts, 'account')}, {formatCount(resetPreview.currentCounts.transactions, 'transaction')}, and {formatCount(resetPreview.currentCounts.imports, 'import')} will be removed.</p>
                    <p>{formatCount(resetPreview.currentCounts.importTemplates, 'import template')}, {formatCount(resetPreview.currentCounts.budgets, 'budget record')}, and {formatCount(resetPreview.currentCounts.rules, 'rule')} will be removed.</p>
                    <p>Categories will be replaced with the authoritative system taxonomy.</p>
                  </>
                )}
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={() => exportBackup(resetPreview.backupScope)}
                disabled={exporting || resetting || restoring}
              >
                <Download /> Export {DATA_SCOPE_DEFINITIONS[resetPreview.backupScope].label} backup first
              </Button>

              <div className="flex items-start gap-3">
                <Checkbox
                  id="confirm-data-reset"
                  checked={resetConfirmed}
                  onCheckedChange={(value) => setResetConfirmed(value === true)}
                  disabled={resetting}
                />
                <Label htmlFor="confirm-data-reset" className="font-normal leading-5">
                  {RESET_OPTIONS[resetPreview.operation].confirmation}
                </Label>
              </div>

              <Button
                variant="destructive"
                onClick={executeReset}
                disabled={!resetConfirmed || resetting || exporting || restoring}
              >
                {resetting ? <Loader2 className="animate-spin" /> : <Trash2 />}
                {resetting ? 'Updating data...' : RESET_OPTIONS[resetPreview.operation].action}
              </Button>
            </div>
          )}
        </section>

        <Separator />

        <ImportHistoryPanel
          externalBusy={exporting || restoring || resetting}
          onExportActivityBackup={() => exportBackup('activity')}
        />
      </CardContent>
    </Card>
  );
}
