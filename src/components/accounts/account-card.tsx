'use client';

import type { Account } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Landmark, CreditCard, Smartphone, Wallet, TrendingUp, HelpCircle, MoreVertical, Archive, Trash2, Edit, TriangleAlert } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '../ui/alert-dialog';

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
  onDelete: (account: Account) => void;
}

export function AccountCard({ account, balance, onEdit, onArchive, onDelete }: AccountCardProps) {

  return (
    <Card className="relative flex flex-col">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="space-y-1">
            <CardTitle className="text-base font-medium">{account.name}</CardTitle>
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
        <AlertDialog>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(account)}>
                <Edit className="mr-2 h-4 w-4" />
                <span>Edit</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onArchive(account)}>
                 <Archive className="mr-2 h-4 w-4" />
                 <span>Archive</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <AlertDialogTrigger asChild>
                <DropdownMenuItem className="text-destructive focus:text-destructive-foreground focus:bg-destructive">
                    <Trash2 className="mr-2 h-4 w-4" />
                    <span>Delete</span>
                </DropdownMenuItem>
              </AlertDialogTrigger>
            </DropdownMenuContent>
          </DropdownMenu>
          <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center">
                  <TriangleAlert className="mr-2 text-destructive" />
                  Delete Account?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete the account "{account.name}"? This action cannot be undone.
                  Accounts with existing transactions cannot be deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => onDelete(account)} className="bg-destructive hover:bg-destructive/90">
                  Delete Account
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
      </div>
    </Card>
  );
}
