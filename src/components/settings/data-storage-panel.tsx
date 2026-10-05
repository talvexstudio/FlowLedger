'use client';

import { useState, type ChangeEvent } from 'react';
import { AlertTriangle, Download, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import type { RestorePreview } from '@/lib/data-management/restore-validation';
import type { BackupScope, PersistedStoreKey } from '@/lib/data-management/store-manifest';

type RestoreApiError = { error?: { code?: string; message?: string } };

const fallbackFilename = (scope: BackupScope) =>
  `flowledger-backup-${scope === 'financial_activity' ? 'financial-activity' : 'everything'}.json`;

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
  const [scope, setScope] = useState<BackupScope>('financial_activity');
  const [exporting, setExporting] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
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
            <div className="flex items-start gap-3 rounded-md border p-4">
              <RadioGroupItem value="financial_activity" id="backup-financial-activity" className="mt-0.5" />
              <Label htmlFor="backup-financial-activity" className="cursor-pointer space-y-1 font-normal">
                <span className="block font-medium">Financial activity</span>
                <span className="block text-sm text-muted-foreground">
                  Workspaces, accounts, categories, imports, and transactions
                </span>
              </Label>
            </div>
            <div className="flex items-start gap-3 rounded-md border p-4">
              <RadioGroupItem value="everything" id="backup-everything" className="mt-0.5" />
              <Label htmlFor="backup-everything" className="cursor-pointer space-y-1 font-normal">
                <span className="block font-medium">Everything</span>
                <span className="block text-sm text-muted-foreground">All FlowLedger data</span>
              </Label>
            </div>
          </RadioGroup>

          <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            Backups contain sensitive financial information and remain on your device unless you move or upload them.
          </p>

          <Button onClick={() => exportBackup(scope)} disabled={exporting || restoring}>
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
              disabled={previewing || restoring}
            />
          </Label>
          {restoreFile && <p className="text-sm text-muted-foreground">Selected: {restoreFile.name}</p>}

          {preview && (
            <div className="space-y-5 rounded-md border p-4">
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <div><span className="text-muted-foreground">Backup date</span><p className="font-medium">{new Date(preview.createdAt).toLocaleString()}</p></div>
                <div><span className="text-muted-foreground">FlowLedger version</span><p className="font-medium">{preview.flowLedgerVersion}</p></div>
                <div><span className="text-muted-foreground">Scope</span><p className="font-medium">{preview.scope === 'everything' ? 'Everything' : 'Financial activity'}</p></div>
              </div>

              <div>
                <h4 className="mb-2 text-sm font-medium">Backup contents</h4>
                <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  {(Object.keys(STORE_LABELS) as PersistedStoreKey[]).map((key) => (
                    <div key={key} className="flex justify-between rounded bg-muted px-3 py-2">
                      <span>{STORE_LABELS[key]}</span><span className="font-medium">{preview.counts[key]}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
                <div className="mb-2 flex items-center gap-2 font-medium text-destructive">
                  <AlertTriangle className="h-4 w-4" /> Replace-all restore
                </div>
                {preview.scope === 'everything' ? (
                  <p>All FlowLedger persisted data will be replaced.</p>
                ) : (
                  <div className="space-y-2">
                    <p>Restoring this backup will replace workspaces, accounts, categories, imports, and transactions.</p>
                    <p>It will clear import templates, budgets, and rules.</p>
                  </div>
                )}
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={() => exportBackup('everything')}
                disabled={exporting || restoring}
              >
                <Download /> Export current backup first
              </Button>

              <div className="flex items-start gap-3">
                <Checkbox
                  id="confirm-restore"
                  checked={confirmed}
                  onCheckedChange={(value) => setConfirmed(value === true)}
                  disabled={restoring}
                />
                <Label htmlFor="confirm-restore" className="font-normal leading-5">
                  I understand that this will replace the current FlowLedger data and cannot be merged.
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
      </CardContent>
    </Card>
  );
}
