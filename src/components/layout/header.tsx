'use client';

import { useEffect, useState } from 'react';

import {
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import {
  Avatar,
  AvatarFallback,
} from '@/components/ui/avatar';
import { ChevronsUpDown, LogOut, Pencil, Plus, Trash2, User } from 'lucide-react';
import { useFlowLedger } from '@/hooks/use-flow-ledger';
import { useToast } from '@/hooks/use-toast';
import { getWorkspaceSelectorLabel } from '@/lib/workspace-selection';
import {
  resolveQueuedWorkspaceDialog,
  type WorkspaceMenuDialogAction,
} from '@/lib/workspace-menu-state';
import type { CreateWorkspaceInput } from '@/lib/workspace-lifecycle-types';
import type { Workspace } from '@/lib/types';
import { WorkspaceFormDialog } from './workspace-form-dialog';
import { WorkspaceDeleteDialog } from './workspace-delete-dialog';
import Link from 'next/link';


export function AppHeader() {
  const {
    workspaces,
    workspaceId,
    setWorkspaceId,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    isLoading,
  } = useFlowLedger();
  const { toast } = useToast();
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [pendingDialog, setPendingDialog] = useState<WorkspaceMenuDialogAction | null>(null);
  const [dialogMode, setDialogMode] = useState<'create' | 'rename' | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTargetWorkspace, setDeleteTargetWorkspace] = useState<Workspace | undefined>();
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
  const workspaceLabel = getWorkspaceSelectorLabel(workspaces, workspaceId, isLoading);
  const currentWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);

  useEffect(() => {
    const action = resolveQueuedWorkspaceDialog(workspaceMenuOpen, pendingDialog);
    if (!action) return;
    setPendingDialog(null);
    if (action === 'delete') {
      setDeleteDialogOpen(true);
    } else {
      setDialogMode(action);
    }
  }, [pendingDialog, workspaceMenuOpen]);

  const queueWorkspaceDialog = (action: WorkspaceMenuDialogAction) => {
    if (action === 'delete') setDeleteTargetWorkspace(currentWorkspace);
    setPendingDialog(action);
    setWorkspaceMenuOpen(false);
  };

  const handleCreate = async (input: CreateWorkspaceInput) => {
    setIsSavingWorkspace(true);
    try {
      const workspace = await createWorkspace(input);
      setDialogMode(null);
      toast({ title: 'Workspace created', description: `${workspace.name} is now selected.` });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Could not create workspace',
        description: (error as Error).message,
      });
    } finally {
      setIsSavingWorkspace(false);
    }
  };

  const handleRename = async (name: string) => {
    setIsSavingWorkspace(true);
    try {
      const workspace = await renameWorkspace(name);
      setDialogMode(null);
      toast({ title: 'Workspace renamed', description: `This workspace is now called ${workspace.name}.` });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Could not rename workspace',
        description: (error as Error).message,
      });
    } finally {
      setIsSavingWorkspace(false);
    }
  };

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b bg-background/80 backdrop-blur-sm px-4 md:px-6">
      <div className="md:hidden">
        <SidebarTrigger variant="outline" size="icon">
          <ChevronsUpDown className="h-4 w-4" />
        </SidebarTrigger>
      </div>
      
      <div className="flex items-center gap-4">
        <DropdownMenu open={workspaceMenuOpen} onOpenChange={setWorkspaceMenuOpen}>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-48 justify-between">
                    {workspaceLabel}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
                <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={workspaceId ?? ''} onValueChange={setWorkspaceId}>
                    {workspaces.map(ws => (
                        <DropdownMenuRadioItem key={ws.id} value={ws.id}>{ws.name}</DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => queueWorkspaceDialog('create')}>
                  <Plus className="mr-2 h-4 w-4" />
                  New workspace
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => queueWorkspaceDialog('rename')}
                  disabled={!currentWorkspace}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Rename workspace
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => queueWorkspaceDialog('delete')}
                  disabled={!currentWorkspace}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete workspace
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="ml-auto flex items-center gap-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              <Avatar>
                <AvatarFallback>U</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <Link href="/settings" className="flex items-center w-full">
                <User className="mr-2 h-4 w-4" />
                <span>Profile</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <Link href="/login" className="flex items-center w-full">
                <LogOut className="mr-2 h-4 w-4" />
                <span>Log out</span>
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <WorkspaceFormDialog
        mode={dialogMode ?? 'create'}
        isOpen={dialogMode !== null}
        onOpenChange={(open) => {
          if (!open && !isSavingWorkspace) setDialogMode(null);
        }}
        workspaces={workspaces}
        currentWorkspace={currentWorkspace}
        onCreate={handleCreate}
        onRename={handleRename}
        isSaving={isSavingWorkspace}
      />
      <WorkspaceDeleteDialog
        isOpen={deleteDialogOpen}
        workspace={deleteTargetWorkspace}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) setDeleteTargetWorkspace(undefined);
        }}
        onDelete={deleteWorkspace}
      />
    </header>
  );
}
