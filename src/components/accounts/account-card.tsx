'use client';

import { useEffect, useState } from 'react';

import type { Account } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Landmark, CreditCard, Smartphone, Wallet, TrendingUp, HelpCircle, MoreVertical, Archive, Trash2, Edit, ArchiveRestore } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { resolveQueuedAccountDelete } from '@/lib/account-lifecycle';

const accountIcons: { [key in Account['type']]: React.ReactNode } = {
  bank: <Landmark className="h-4 w-4 text-muted-foreground" />,
  credit_card: <CreditCard className="h-4 w-4 text-muted-foreground" />,
  fintech: <Smartphone className="h-4 w-4 text-muted-foreground" />,
  cash: <Wallet className="h-4 w-4 text-muted-foreground" />,
  investment: <TrendingUp className="h-4 w-4 text-muted-foreground" />,
  other: <HelpCircle className="h-4 w-4 text-muted-foreground" />,
};

interface AccountCardProps {
  account: Account;
  balance: number;
  onEdit: (account: Account) => void;
  onArchive: (account: Account) => void;
  onRestore: (account: Account) => void;
  onDelete: (account: Account) => void;
}

export function AccountCard({ account, balance, onEdit, onArchive, onRestore, onDelete }: AccountCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteQueued, setDeleteQueued] = useState(false);

  useEffect(() => {
    const target = resolveQueuedAccountDelete(menuOpen, deleteQueued ? account : null);
    if (!target) return;
    setDeleteQueued(false);
    onDelete(target);
  }, [account, deleteQueued, menuOpen, onDelete]);

  return (
    <Card className="relative flex flex-col">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-medium">{account.name}</CardTitle>
              {account.archived && <Badge variant="secondary">Archived</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">{account.institution}</p>
        </div>
        {accountIcons[account.type]}
      </CardHeader>
      <CardContent className="flex-grow flex flex-col justify-end">
        <div className="text-2xl font-bold">
          {new Intl.NumberFormat('de-DE', { style: 'currency', currency: account.currency }).format(balance)}
        </div>
      </CardContent>
      <div className="absolute top-2 right-2">
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Manage ${account.name}`}>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {account.archived ? (
                <DropdownMenuItem onSelect={() => onRestore(account)}>
                  <ArchiveRestore className="mr-2 h-4 w-4" />
                  <span>Restore account</span>
                </DropdownMenuItem>
              ) : (
                <>
                  <DropdownMenuItem onSelect={() => onEdit(account)}>
                    <Edit className="mr-2 h-4 w-4" />
                    <span>Edit</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onArchive(account)}>
                    <Archive className="mr-2 h-4 w-4" />
                    <span>Archive</span>
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  setDeleteQueued(true);
                  setMenuOpen(false);
                }}
                className="text-destructive focus:text-destructive-foreground focus:bg-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                <span>Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
      </div>
    </Card>
  );
}
