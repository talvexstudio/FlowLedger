'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Download, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { apiPreviewWorkspaceDeletion } from '@/lib/api';
import { downloadBackup } from '@/lib/data-management/backup-download';
import type {
  WorkspaceDeletionPreview,
  WorkspaceDeletionResult,
} from '@/lib/data-management/workspace-deletion-types';
import {
  canSubmitWorkspaceDeletion,
  workspaceDeletionBackupRequest,
} from '@/lib/data-management/workspace-deletion-ui';
import { formatCount } from '@/lib/data-management/ui-copy';
import type { Workspace } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

type WorkspaceDeleteDialogProps = {
  isOpen: boolean;
  workspace?: Workspace;
  onOpenChange: (isOpen: boolean) => void;
  onDelete: (workspaceId: string) => Promise<WorkspaceDeletionResult>;
};

const impactRows = (preview: WorkspaceDeletionPreview) => [
  formatCount(preview.accountsCount, 'account'),
  formatCount(preview.categoriesCount, 'category', 'categories'),
  formatCount(preview.subcategoriesCount, 'subcategory', 'subcategories'),
  formatCount(preview.importsCount, 'import'),
  formatCount(preview.importTemplatesCount, 'import template'),
  formatCount(preview.budgetsCount, 'budget'),
  formatCount(preview.rulesCount, 'rule'),
  formatCount(preview.transactionsCount, 'transaction'),
];

export function WorkspaceDeleteDialog({
  isOpen,
  workspace,
  onOpenChange,
  onDelete,
}: WorkspaceDeleteDialogProps) {
  const [preview, setPreview] = useState<WorkspaceDeletionPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!isOpen || !workspace) return;
    let current = true;
    setPreview(null);
    setPreviewError(null);
    setConfirmed(false);
    setDeleting(false);
    setExporting(false);
    setPreviewing(true);
    apiPreviewWorkspaceDeletion(workspace.id)
      .then((value) => {
        if (current) setPreview(value);
      })
      .catch((error) => {
        if (current) setPreviewError(error instanceof Error ? error.message : 'Could not review workspace deletion.');
      })
      .finally(() => {
        if (current) setPreviewing(false);
      });
    return () => { current = false; };
  }, [isOpen, workspace]);

  const exportBackup = async () => {
    if (!workspace) return;
    setExporting(true);
    try {
      const request = workspaceDeletionBackupRequest(workspace.id);
      await downloadBackup(request.scope, request.workspaceId);
      toast({ title: 'Backup exported', description: `${workspace.name} Financial Data was downloaded.` });
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

  const deleteSelectedWorkspace = async () => {
    if (!workspace || !canSubmitWorkspaceDeletion(preview, confirmed, deleting)) return;
    setDeleting(true);
    try {
      const result = await onDelete(workspace.id);
      setDeleting(false);
      onOpenChange(false);
      toast({
        title: 'Workspace deleted',
        description: result.cleanupWarning ?? `${workspace.name} and its data were permanently deleted.`,
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Could not delete workspace',
        description: error instanceof Error ? error.message : 'Workspace deletion failed.',
      });
      setDeleting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!deleting) onOpenChange(open);
    }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Delete {workspace ? `“${workspace.name}”` : 'workspace'}?</DialogTitle>
          <DialogDescription>
            This permanently removes this workspace and all data stored inside it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {previewing && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Reviewing impact…
            </div>
          )}

          {previewError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {previewError}
            </div>
          )}

          {preview && (
            <>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {impactRows(preview).map((label) => (
                  <div key={label} className="rounded-md bg-muted px-3 py-2">{label}</div>
                ))}
              </div>

              <p className="text-sm text-muted-foreground">Other workspaces will not be affected.</p>

              {!preview.canDelete && (
                <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <span>{preview.blockingReason}</span>
                </div>
              )}

              {preview.canDelete && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={exportBackup}
                    disabled={exporting || deleting}
                  >
                    {exporting ? <Loader2 className="animate-spin" /> : <Download />}
                    Export Financial Data backup first
                  </Button>

                  <div className="flex items-start gap-3 rounded-md border border-destructive/30 p-3">
                    <Checkbox
                      id="confirm-workspace-delete"
                      checked={confirmed}
                      onCheckedChange={(checked) => setConfirmed(checked === true)}
                      disabled={deleting}
                    />
                    <Label htmlFor="confirm-workspace-delete" className="text-sm font-normal leading-5">
                      I understand that this workspace and all of its data will be permanently deleted.
                    </Label>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
          {preview?.canDelete && (
            <Button
              type="button"
              variant="destructive"
              onClick={deleteSelectedWorkspace}
              disabled={!canSubmitWorkspaceDeletion(preview, confirmed, deleting) || exporting}
            >
              {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
              {deleting ? 'Deleting…' : 'Delete workspace'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
