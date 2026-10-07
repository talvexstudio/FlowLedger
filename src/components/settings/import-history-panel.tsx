'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Download, FileClock, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useFlowLedger } from '@/hooks/use-flow-ledger';
import {
  IMPORT_HISTORY_ACTION_OPTIONS,
  type ImportHistoryAction,
  type ImportHistoryPreview,
  type ImportHistoryResult,
  type ImportHistorySummary,
} from '@/lib/data-management/import-history-types';
import { formatCount } from '@/lib/data-management/ui-copy';
import { isWorkspaceResponseCurrent } from '@/lib/workspace-client-state';

type ApiError = { error?: { code?: string; message?: string } };

type ImportHistoryPanelProps = {
  externalBusy?: boolean;
  onExportActivityBackup: () => Promise<void>;
};

const formatImportDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

export function ImportHistoryPanel({
  externalBusy = false,
  onExportActivityBackup,
}: ImportHistoryPanelProps) {
  const { workspaceId, reloadTransactions } = useFlowLedger();
  const { toast } = useToast();
  const [imports, setImports] = useState<ImportHistorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportHistoryPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [executing, setExecuting] = useState(false);
  const workspaceIdRef = useRef(workspaceId);
  workspaceIdRef.current = workspaceId;

  const loadImports = useCallback(async () => {
    setImports([]);
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    const requestedWorkspaceId = workspaceId;
    setLoading(true);
    try {
      const response = await fetch(
        `/api/data-management/import-history?workspaceId=${encodeURIComponent(workspaceId)}`,
        { cache: 'no-store' }
      );
      const payload = await response.json() as { imports?: ImportHistorySummary[] } & ApiError;
      if (!response.ok || !payload.imports) {
        throw new Error(payload.error?.message ?? 'Import history could not be loaded.');
      }
      if (isWorkspaceResponseCurrent(workspaceIdRef.current, requestedWorkspaceId)) setImports(payload.imports);
    } catch (error) {
      if (!isWorkspaceResponseCurrent(workspaceIdRef.current, requestedWorkspaceId)) return;
      setImports([]);
      toast({
        variant: 'destructive',
        title: 'Import history unavailable',
        description: error instanceof Error ? error.message : 'Import history could not be loaded.',
      });
    } finally {
      if (isWorkspaceResponseCurrent(workspaceIdRef.current, requestedWorkspaceId)) setLoading(false);
    }
  }, [toast, workspaceId]);

  useEffect(() => {
    setPreview(null);
    setConfirmed(false);
    void loadImports();
  }, [loadImports]);

  const reviewAction = async (action: ImportHistoryAction, importId?: string) => {
    setPreview(null);
    setConfirmed(false);
    setPreviewing(`${action}:${importId ?? 'all'}`);
    try {
      const response = await fetch('/api/data-management/import-history/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, action, importId }),
      });
      const payload = await response.json() as { preview?: ImportHistoryPreview } & ApiError;
      if (!response.ok || !payload.preview) {
        throw new Error(payload.error?.message ?? 'The import-history impact could not be calculated.');
      }
      setPreview(payload.preview);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Impact review failed',
        description: error instanceof Error ? error.message : 'The import-history impact could not be calculated.',
      });
    } finally {
      setPreviewing(null);
    }
  };

  const executeAction = async () => {
    if (!preview || !confirmed || !preview.allowed) return;
    setExecuting(true);
    try {
      const response = await fetch('/api/data-management/import-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          action: preview.action,
          importId: preview.import?.id,
          confirmed: true,
        }),
      });
      const payload = await response.json() as { result?: ImportHistoryResult } & ApiError;
      if (!response.ok || !payload.result) {
        throw new Error(payload.error?.message ?? 'The import-history operation could not be completed.');
      }
      toast({
        title: `${IMPORT_HISTORY_ACTION_OPTIONS[preview.action].label} complete`,
        description: payload.result.cleanupWarning ?? 'Import history was updated successfully.',
      });
      setPreview(null);
      setConfirmed(false);
      await Promise.all([loadImports(), reloadTransactions()]);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Import-history operation failed',
        description: error instanceof Error ? error.message : 'The import-history operation could not be completed.',
      });
    } finally {
      setExecuting(false);
    }
  };

  const busy = externalBusy || loading || previewing !== null || executing;
  const previewOption = preview ? IMPORT_HISTORY_ACTION_OPTIONS[preview.action] : null;

  return (
    <section className="space-y-4">
      <div>
        <h3 className="font-medium">Import History</h3>
        <p className="text-sm text-muted-foreground">
          Review previous imports and remove imported transactions when needed.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading import history...
        </div>
      ) : imports.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          No import sessions are available.
        </p>
      ) : (
        <div className="space-y-3">
          {imports.map((importSession) => (
            <div key={importSession.id} className="space-y-3 rounded-md border p-4">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 font-medium">
                    <FileClock className="h-4 w-4 shrink-0" />
                    <span className="truncate">{importSession.fileName}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {importSession.sourceType} · {formatImportDate(importSession.createdAt)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {importSession.accountName}
                  </p>
                  {importSession.template && (
                    <p className="text-sm text-muted-foreground">Template: {importSession.template}</p>
                  )}
                  <p className="text-sm">
                    {formatCount(importSession.linkedTransactionCount, 'linked transaction')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={() => reviewAction('delete_with_transactions', importSession.id)}
                  >
                    {previewing === `delete_with_transactions:${importSession.id}` ? <Loader2 className="animate-spin" /> : <Trash2 />}
                    Delete import and transactions
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          disabled={busy || imports.length === 0}
          onClick={() => reviewAction('delete_all_with_transactions')}
        >
          {previewing === 'delete_all_with_transactions:all' ? <Loader2 className="animate-spin" /> : <Trash2 />}
          Delete all imported transactions
        </Button>
      </div>

      {preview && previewOption && (
        <div className="space-y-5 rounded-md border border-destructive/40 bg-destructive/5 p-4">
          <div className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="h-4 w-4" /> {previewOption.label}
          </div>

          {preview.import && (
            <div className="text-sm">
              <p className="font-medium">{preview.import.fileName}</p>
              <p className="text-muted-foreground">
                {preview.import.sourceType} · {preview.import.accountName} · {formatImportDate(preview.import.createdAt)}
              </p>
            </div>
          )}

          <div className="space-y-2 text-sm">
            <p><strong>{formatCount(preview.transactionsToDelete, 'transaction')}</strong> will be deleted.</p>
            <p><strong>{formatCount(preview.importSessionCount, 'import session')}</strong> will be removed.</p>
            <p>{formatCount(preview.transactionsToPreserve, 'other transaction')} will be preserved.</p>
          </div>

          {!preview.allowed && (
            <p className="rounded-md border border-destructive/40 bg-background p-3 text-sm text-destructive">
              {formatCount(preview.blockedLinkedPairCount, 'linked transfer pair')} cross the import boundary.
              Both legs must be included in the same deletion, so this operation is blocked.
            </p>
          )}

          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onExportActivityBackup}
          >
            <Download /> Export Activity backup first
          </Button>

          <div className="flex items-start gap-3">
            <Checkbox
              id="confirm-import-history"
              checked={confirmed}
              onCheckedChange={(value) => setConfirmed(value === true)}
              disabled={executing || !preview.allowed}
            />
            <Label htmlFor="confirm-import-history" className="font-normal leading-5">
              {previewOption.confirmation}
            </Label>
          </div>

          <Button
            type="button"
            variant="destructive"
            disabled={!confirmed || !preview.allowed || busy}
            onClick={executeAction}
          >
            {executing ? <Loader2 className="animate-spin" /> : <Trash2 />}
            {executing ? 'Updating import history...' : previewOption.label}
          </Button>
        </div>
      )}
    </section>
  );
}
