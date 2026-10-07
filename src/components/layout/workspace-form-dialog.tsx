'use client';

import { useEffect, useState } from 'react';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Workspace } from '@/lib/types';
import {
  SUPPORTED_WORKSPACE_CURRENCIES,
  WORKSPACE_NAME_MAX_LENGTH,
  canCopyWorkspaceCategories,
  type CreateWorkspaceInput,
  type SupportedWorkspaceCurrency,
  type WorkspaceCategoryMode,
} from '@/lib/workspace-lifecycle-types';

type WorkspaceFormDialogProps = {
  mode: 'create' | 'rename';
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  workspaces: Workspace[];
  currentWorkspace?: Workspace;
  onCreate: (input: CreateWorkspaceInput) => Promise<void>;
  onRename: (name: string) => Promise<void>;
  isSaving: boolean;
};

const CURRENCY_LABELS: Record<SupportedWorkspaceCurrency, string> = {
  EUR: 'EUR — Euro',
  USD: 'USD — US Dollar',
  GBP: 'GBP — British Pound',
  CHF: 'CHF — Swiss Franc',
};

export function WorkspaceFormDialog({
  mode,
  isOpen,
  onOpenChange,
  workspaces,
  currentWorkspace,
  onCreate,
  onRename,
  isSaving,
}: WorkspaceFormDialogProps) {
  const [name, setName] = useState('');
  const [baseCurrency, setBaseCurrency] = useState<SupportedWorkspaceCurrency>('EUR');
  const [categoryMode, setCategoryMode] = useState<WorkspaceCategoryMode>('default');
  const [sourceWorkspaceId, setSourceWorkspaceId] = useState('');
  const canCopyCategories = canCopyWorkspaceCategories(workspaces);

  useEffect(() => {
    if (!isOpen) return;
    setName(mode === 'rename' ? currentWorkspace?.name ?? '' : '');
    setBaseCurrency('EUR');
    setCategoryMode('default');
    setSourceWorkspaceId(currentWorkspace?.id ?? workspaces[0]?.id ?? '');
  }, [currentWorkspace, isOpen, mode, workspaces]);

  const trimmedName = name.trim();
  const copyIsValid = categoryMode !== 'copy' || Boolean(sourceWorkspaceId);
  const canSubmit = Boolean(trimmedName) && copyIsValid && !isSaving;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    if (mode === 'rename') {
      await onRename(trimmedName);
      return;
    }
    await onCreate({
      name: trimmedName,
      baseCurrency,
      categoryMode,
      ...(categoryMode === 'copy' ? { sourceWorkspaceId } : {}),
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{mode === 'create' ? 'New workspace' : 'Rename workspace'}</DialogTitle>
            <DialogDescription>
              {mode === 'create'
                ? 'Create a separate space for accounts, activity, and financial setup.'
                : 'Change the workspace name without changing its data.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-5">
            <div className="space-y-2">
              <Label htmlFor="workspace-name">Workspace name</Label>
              <Input
                id="workspace-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Business"
                maxLength={WORKSPACE_NAME_MAX_LENGTH}
                disabled={isSaving}
                autoFocus
              />
            </div>

            {mode === 'create' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="workspace-currency">Base currency</Label>
                  <Select
                    value={baseCurrency}
                    onValueChange={(value) => setBaseCurrency(value as SupportedWorkspaceCurrency)}
                    disabled={isSaving}
                  >
                    <SelectTrigger id="workspace-currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SUPPORTED_WORKSPACE_CURRENCIES.map((currency) => (
                        <SelectItem key={currency} value={currency}>
                          {CURRENCY_LABELS[currency]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Used as reporting context. Currency conversion is not applied.
                  </p>
                </div>

                <fieldset className="space-y-3">
                  <legend className="text-sm font-medium">Starting categories</legend>
                  <RadioGroup
                    value={categoryMode}
                    onValueChange={(value) => setCategoryMode(value as WorkspaceCategoryMode)}
                    disabled={isSaving}
                    className="gap-3"
                  >
                    <CategoryModeOption
                      id="workspace-categories-default"
                      value="default"
                      label="Default categories"
                      description="Start with FlowLedger's editable starter taxonomy."
                    />
                    <CategoryModeOption
                      id="workspace-categories-copy"
                      value="copy"
                      label="Copy categories from another workspace"
                      description="Create an independent copy with new category IDs."
                      disabled={!canCopyCategories}
                    />
                    <CategoryModeOption
                      id="workspace-categories-empty"
                      value="empty"
                      label="Start empty"
                      description="Create the workspace without categories."
                    />
                  </RadioGroup>
                </fieldset>

                {categoryMode === 'copy' && canCopyCategories && (
                  <div className="space-y-2 pl-7">
                    <Label htmlFor="source-workspace">Copy from</Label>
                    <Select
                      value={sourceWorkspaceId}
                      onValueChange={setSourceWorkspaceId}
                      disabled={isSaving}
                    >
                      <SelectTrigger id="source-workspace">
                        <SelectValue placeholder="Choose a workspace" />
                      </SelectTrigger>
                      <SelectContent>
                        {workspaces.map((workspace) => (
                          <SelectItem key={workspace.id} value={workspace.id}>
                            {workspace.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isSaving
                ? (mode === 'create' ? 'Creating…' : 'Saving…')
                : (mode === 'create' ? 'Create workspace' : 'Save name')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CategoryModeOption({
  id,
  value,
  label,
  description,
  disabled = false,
}: {
  id: string;
  value: WorkspaceCategoryMode;
  label: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <RadioGroupItem id={id} value={value} disabled={disabled} className="mt-0.5" />
      <Label htmlFor={id} className={disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}>
        <span className="block">{label}</span>
        <span className="block text-xs font-normal text-muted-foreground">{description}</span>
      </Label>
    </div>
  );
}
