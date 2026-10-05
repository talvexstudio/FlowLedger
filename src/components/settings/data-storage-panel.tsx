'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useToast } from '@/hooks/use-toast';
import type { BackupScope } from '@/lib/data-management/store-manifest';

const fallbackFilename = (scope: BackupScope) =>
  `flowledger-backup-${scope === 'financial_activity' ? 'financial-activity' : 'everything'}.json`;

const responseFilename = (header: string | null, scope: BackupScope) => {
  const match = header?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? fallbackFilename(scope);
};

export function DataStoragePanel() {
  const [scope, setScope] = useState<BackupScope>('financial_activity');
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();

  const exportBackup = async () => {
    setExporting(true);
    try {
      const response = await fetch('/api/data-management/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? 'Could not export the backup.');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = responseFilename(response.headers.get('Content-Disposition'), scope);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      toast({
        title: 'Backup exported',
        description: 'The backup was downloaded to your device.',
      });
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data &amp; Storage</CardTitle>
        <CardDescription>Export a local copy of your FlowLedger data.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
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
        </div>

        <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
          Backups contain sensitive financial information and remain on your device unless you move or upload them.
        </p>

        <Button onClick={exportBackup} disabled={exporting}>
          {exporting ? <Loader2 className="animate-spin" /> : <Download />}
          {exporting ? 'Exporting...' : 'Export backup'}
        </Button>

        <p className="text-sm text-muted-foreground">
          Restore and data-management tools will be added in a later step.
        </p>
      </CardContent>
    </Card>
  );
}
