'use client';

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
import { ChevronsUpDown, LogOut, User } from 'lucide-react';
import { useFlowLedger } from '@/hooks/use-flow-ledger';
import { getWorkspaceSelectorLabel } from '@/lib/workspace-selection';
import Link from 'next/link';


export function AppHeader() {
  const { workspaces, workspaceId, setWorkspaceId, isLoading } = useFlowLedger();
  const workspaceLabel = getWorkspaceSelectorLabel(workspaces, workspaceId, isLoading);

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b bg-background/80 backdrop-blur-sm px-4 md:px-6">
      <div className="md:hidden">
        <SidebarTrigger variant="outline" size="icon">
          <ChevronsUpDown className="h-4 w-4" />
        </SidebarTrigger>
      </div>
      
      <div className="flex items-center gap-4">
        <DropdownMenu>
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
    </header>
  );
}
