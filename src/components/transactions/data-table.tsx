'use client';

import * as React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ListFilter, Calendar as CalendarIcon, Check, Edit, MoreVertical, ChevronLeft, ChevronRight, X, Trash2, Download, Loader2 } from 'lucide-react';
import type { Transaction } from '@/lib/types';
import { useFlowLedger } from '@/hooks/use-flow-ledger';
import { DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuCheckboxItem } from '../ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Calendar } from '../ui/calendar';
import type { DateRange } from 'react-day-picker';
import { endOfDay, format } from 'date-fns';
import { Input } from '../ui/input';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { TransactionBulkDeletePreview } from '@/lib/data-management/transaction-bulk-delete-types';
import { formatCount } from '@/lib/data-management/ui-copy';
import {
  getInternalTransferDisplay,
  getInternalTransferPairingStatus,
} from '@/lib/internal-transfer';
import {
  ALL_ACCOUNTS_FILTER_ID,
  ALL_CATEGORIES_FILTER_ID,
  UNCATEGORIZED_CATEGORY_FILTER_ID,
  getAccountFilterOptions,
  getCategoryFilterOptions,
  matchesTransactionFilters,
} from '@/lib/transaction-filtering';

const ITEMS_PER_PAGE = 20;

interface TransactionsDataTableProps {
  onEdit: (transaction: Transaction) => void;
  onConfirm: (transaction: Transaction) => void;
  onDelete: (transaction: Transaction) => void;
  onBulkDeletePreview: (ids: string[]) => Promise<TransactionBulkDeletePreview | null>;
  onBulkDelete: (ids: string[]) => Promise<boolean>;
  onExportActivityBackup: () => Promise<void>;
}

export const nextSelectionAfterBulkDelete = (selectedIds: string[], succeeded: boolean) =>
  succeeded ? [] : selectedIds;

export const clampTransactionPage = (currentPage: number, totalPages: number) =>
  Math.min(Math.max(currentPage, 1), Math.max(totalPages, 1));

export const incompleteLinkedPairMessage = (count: number) =>
  `${count} linked transfer pair${count === 1 ? ' is' : 's are'} incomplete. Select both transfer transactions before deleting.`;

export function TransactionsDataTable({
  onEdit,
  onConfirm,
  onDelete,
  onBulkDeletePreview,
  onBulkDelete,
  onExportActivityBackup,
}: TransactionsDataTableProps) {
  const { accounts, categories, transactions } = useFlowLedger();
  const [accountFilter, setAccountFilter] = React.useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = React.useState<string[]>([]);
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>();
  const [currentPage, setCurrentPage] = React.useState(1);
  const [openMenuId, setOpenMenuId] = React.useState<string | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false);
  const [bulkDeletePreview, setBulkDeletePreview] = React.useState<TransactionBulkDeletePreview | null>(null);
  const [bulkPreviewing, setBulkPreviewing] = React.useState(false);
  const [bulkDeleting, setBulkDeleting] = React.useState(false);
  const [bulkConfirmed, setBulkConfirmed] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');

  const getCategoryName = (catId?: string) => categories.find(c => c.id === catId)?.name || 'Uncategorized';
  const getAccountName = (accId: string) => accounts.find(a => a.id === accId)?.name || 'Unknown';
  
  const activeAccounts = React.useMemo(() => accounts.filter(a => !a.archived), [accounts]);
  const accountFilterOptions = React.useMemo(() => getAccountFilterOptions(accounts), [accounts]);
  const categoryFilterOptions = React.useMemo(() => getCategoryFilterOptions(categories), [categories]);

  const filteredTransactions = React.useMemo(() => {
    let data = [...transactions];
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (accountFilter.length > 0 || categoryFilter.length > 0) {
      data = data.filter(t => matchesTransactionFilters(t, accountFilter, categoryFilter));
    }
    if (dateRange?.from) {
      data = data.filter(t => new Date(t.date) >= dateRange.from!);
    }
    if (dateRange?.to) {
      // Set time to end of day to include all transactions on the 'to' date
      const toDate = endOfDay(dateRange.to);
      data = data.filter(t => new Date(t.date) <= toDate);
    }
    if (normalizedQuery) {
      data = data.filter((t) => {
        const description = (t.description || '').toLowerCase();
        const rawDescription = (t.rawDescription || '').toLowerCase();
        return description.includes(normalizedQuery) || rawDescription.includes(normalizedQuery);
      });
    }
    return data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, accountFilter, categoryFilter, dateRange, searchQuery]);
  
  const totalPages = Math.ceil(filteredTransactions.length / ITEMS_PER_PAGE);
  const paginatedTransactions = filteredTransactions.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const pageIds = paginatedTransactions.map(t => t.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.includes(id));
  const somePageSelected = pageIds.some(id => selectedIds.includes(id)) && !allPageSelected;

  React.useEffect(() => {
    const existingIds = new Set(transactions.map(t => t.id));
    setSelectedIds(prev => prev.filter(id => existingIds.has(id)));
  }, [transactions]);

  React.useEffect(() => {
    const availableIds = new Set(activeAccounts.map((account) => account.id));
    setAccountFilter((current) => current.filter((id) => availableIds.has(id)));
  }, [activeAccounts]);

  React.useEffect(() => {
    const availableIds = new Set(categories.map((category) => category.id));
    setCategoryFilter((current) => current.filter(
      (id) => id === UNCATEGORIZED_CATEGORY_FILTER_ID || availableIds.has(id)
    ));
  }, [categories]);

  React.useEffect(() => {
    setCurrentPage((page) => clampTransactionPage(page, totalPages));
  }, [totalPages]);

  const reviewBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    setBulkDeleteOpen(true);
    setBulkDeletePreview(null);
    setBulkConfirmed(false);
    setBulkPreviewing(true);
    try {
      setBulkDeletePreview(await onBulkDeletePreview(selectedIds));
    } finally {
      setBulkPreviewing(false);
    }
  };

  const executeBulkDelete = async () => {
    if (!bulkDeletePreview?.allowed || !bulkConfirmed) return;
    setBulkDeleting(true);
    try {
      const succeeded = await onBulkDelete(selectedIds);
      setSelectedIds((current) => nextSelectionAfterBulkDelete(current, succeeded));
      if (succeeded) {
        setBulkDeleteOpen(false);
        setBulkDeletePreview(null);
        setBulkConfirmed(false);
      }
    } finally {
      setBulkDeleting(false);
    }
  };

  const toggleAccountFilter = (accountId: string) => {
    setAccountFilter(prev =>
      prev.includes(accountId)
        ? prev.filter(id => id !== accountId)
        : [...prev, accountId]
    );
  };

  const toggleCategoryFilter = (categoryId: string) => {
    setCategoryFilter(prev =>
      prev.includes(categoryId)
        ? prev.filter(id => id !== categoryId)
        : [...prev, categoryId]
    );
  }

  const clearFilters = () => {
    setAccountFilter([]);
    setCategoryFilter([]);
    setDateRange(undefined);
    setCurrentPage(1);
  };
  
  const activeFiltersCount = [accountFilter, categoryFilter, dateRange].filter(f => f && (Array.isArray(f) ? f.length > 0 : f.from)).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>All Transactions</CardTitle>
          <CardDescription>
            {filteredTransactions.length} transaction(s) found.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
            <Input
              placeholder="Search description..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="max-w-xs"
            />
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  id="date"
                  variant={"outline"}
                  className={"w-[300px] justify-start text-left font-normal"}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateRange?.from ? (
                    dateRange.to ? (
                      <>
                        {format(dateRange.from, "LLL dd, y")} -{" "}
                        {format(dateRange.to, "LLL dd, y")}
                      </>
                    ) : (
                      format(dateRange.from, "LLL dd, y")
                    )
                  ) : (
                    <span>Pick a date range</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  initialFocus
                  mode="range"
                  defaultMonth={dateRange?.from}
                  selected={dateRange}
                  onSelect={setDateRange}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="relative">
                <ListFilter className="mr-2 h-4 w-4" />
                Filter
                {activeFiltersCount > 0 && (
                  <Badge variant="secondary" className="absolute -right-2 -top-2 rounded-full p-1 h-5 w-5 justify-center">{activeFiltersCount}</Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Filter by</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Accounts</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                      {accountFilterOptions.map(option => (
                        <DropdownMenuCheckboxItem
                            key={option.id}
                            checked={option.id === ALL_ACCOUNTS_FILTER_ID
                              ? accountFilter.length === 0
                              : accountFilter.includes(option.id)}
                            onCheckedChange={() => option.id === ALL_ACCOUNTS_FILTER_ID
                              ? setAccountFilter([])
                              : toggleAccountFilter(option.id)}
                        >
                            {option.label}
                        </DropdownMenuCheckboxItem>
                        ))}
                  </DropdownMenuSubContent>
              </DropdownMenuSub>
               <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Categories</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                      {categoryFilterOptions.map(option => (
                        <DropdownMenuCheckboxItem
                            key={option.id}
                            checked={option.id === ALL_CATEGORIES_FILTER_ID
                              ? categoryFilter.length === 0
                              : categoryFilter.includes(option.id)}
                            onCheckedChange={() => option.id === ALL_CATEGORIES_FILTER_ID
                              ? setCategoryFilter([])
                              : toggleCategoryFilter(option.id)}
                        >
                            {option.label}
                        </DropdownMenuCheckboxItem>
                        ))}
                  </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
          {activeFiltersCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="mr-2 h-4 w-4" />
              Clear filters
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {selectedIds.length > 0 && (
          <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
            <span>{selectedIds.length} transaction(s) selected</span>
            <Button variant="destructive" size="sm" onClick={reviewBulkDelete} disabled={bulkPreviewing || bulkDeleting}>
              {bulkPreviewing && <Loader2 className="animate-spin" />}
              Delete selected
            </Button>
          </div>
        )}
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allPageSelected || (somePageSelected ? "indeterminate" : false)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedIds(prev => Array.from(new Set([...prev, ...pageIds])));
                      } else {
                        setSelectedIds(prev => prev.filter(id => !pageIds.includes(id)));
                      }
                    }}
                    aria-label="Select all transactions on page"
                  />
                </TableHead>
                <TableHead className="w-[100px]">Date</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-center w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedTransactions.length > 0 ? (
                paginatedTransactions.map((t) => (
                  <TableRow key={t.id} data-state={t.needsReview ? 'selected' : ''}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.includes(t.id)}
                        onCheckedChange={(checked) => {
                          setSelectedIds(prev =>
                            checked ? [...prev, t.id] : prev.filter(id => id !== t.id)
                          );
                        }}
                        aria-label={`Select transaction ${t.description}`}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{new Date(t.date).toLocaleDateString()}</TableCell>
                    <TableCell>{getAccountName(t.accountId)}</TableCell>
                    <TableCell className="font-medium">
                      <div className="flex flex-col gap-1">
                        <span>{t.description}</span>
                        {t.isPotentialDuplicate && (
                          <>
                            <Badge variant="outline" className="w-fit text-xs border-orange-400 text-orange-600">
                              Potential duplicate
                            </Badge>
                            {t.potentialDuplicateMatch && (
                              <span className="text-xs font-normal text-muted-foreground">
                                Matches {new Date(t.potentialDuplicateMatch.date).toLocaleDateString()}
                                {' · '}{t.potentialDuplicateMatch.description}
                                {' · '}{new Intl.NumberFormat('de-DE', {
                                  style: 'currency',
                                  currency: 'EUR',
                                }).format(t.potentialDuplicateMatch.amountBase)}
                              </span>
                            )}
                          </>
                        )}
                        {t.isPotentialTransfer && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-fit h-auto px-2 py-0.5 text-xs border border-blue-400 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950"
                            onClick={() => onEdit(t)}
                          >
                            Review transfer match →
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant={t.type === 'InternalTransfer' ? "secondary" : "outline"}>
                          {getInternalTransferDisplay(t, accounts) ?? getCategoryName(t.categoryId)}
                        </Badge>
                        {getInternalTransferPairingStatus(t) && (
                          <span className="text-xs text-muted-foreground">
                            {getInternalTransferPairingStatus(t)}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className={`text-right font-semibold ${t.amountBase > 0 ? 'text-green-600 dark:text-green-400' : ''}`}>
                      {new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(t.amountBase)}
                    </TableCell>
                    <TableCell className="text-center">
                        <DropdownMenu
                          open={openMenuId === t.id}
                          onOpenChange={(open) => setOpenMenuId(open ? t.id : null)}
                        >
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon">
                                    <MoreVertical className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                {t.needsReview && !t.isPotentialDuplicate && (
                                    <DropdownMenuItem onClick={() => { setOpenMenuId(null); onConfirm(t); }}>
                                        <Check className="mr-2 h-4 w-4 text-green-500" />
                                        Confirm
                                    </DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={() => { setOpenMenuId(null); onEdit(t); }}>
                                    <Edit className="mr-2 h-4 w-4 text-primary" />
                                    Edit
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => { setOpenMenuId(null); onDelete(t); }} className="text-destructive focus:text-destructive-foreground focus:bg-destructive">
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Delete
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    No transactions found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
         <div className="flex items-center justify-between space-x-2 py-4">
            <div className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages || 1}
            </div>
            <div className="flex items-center space-x-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                >
                    <ChevronLeft className="h-4 w-4" />
                    <span>Previous</span>
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages || totalPages === 0}
                >
                    <span>Next</span>
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </div>
        </div>
        <AlertDialog
          open={bulkDeleteOpen}
          onOpenChange={(open) => {
            if (bulkDeleting) return;
            setBulkDeleteOpen(open);
            if (!open) {
              setBulkDeletePreview(null);
              setBulkConfirmed(false);
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete selected transactions?</AlertDialogTitle>
              <AlertDialogDescription>
                Review the exact impact before permanently deleting the selected transactions.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {bulkPreviewing && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Reviewing deletion impact...
              </div>
            )}
            {bulkDeletePreview && (
              <div className="space-y-4 text-sm">
                <div className="space-y-1">
                  <p><strong>{formatCount(bulkDeletePreview.transactionsToDelete, 'transaction')}</strong> will be deleted.</p>
                  <p>{formatCount(bulkDeletePreview.remainingTransactionCount, 'transaction')} will remain.</p>
                  <p>{formatCount(bulkDeletePreview.completeLinkedPairCount, 'complete linked transfer pair')} selected.</p>
                  {bulkDeletePreview.affectedImportSessionCount > 0 && (
                    <p>{formatCount(bulkDeletePreview.affectedImportSessionCount, 'import session')} affected; none will be deleted.</p>
                  )}
                  {bulkDeletePreview.zeroLinkedImportSessionCount > 0 && (
                    <p>{formatCount(bulkDeletePreview.zeroLinkedImportSessionCount, 'import session')} will have no linked transactions afterward.</p>
                  )}
                </div>

                {!bulkDeletePreview.allowed && (
                  <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-destructive">
                    {incompleteLinkedPairMessage(bulkDeletePreview.incompleteLinkedPairCount)}
                  </p>
                )}

                <Button type="button" variant="outline" onClick={onExportActivityBackup} disabled={bulkDeleting}>
                  <Download /> Export Activity backup first
                </Button>

                <div className="flex items-start gap-3">
                  <Checkbox
                    id="confirm-bulk-transaction-delete"
                    checked={bulkConfirmed}
                    onCheckedChange={(value) => setBulkConfirmed(value === true)}
                    disabled={bulkDeleting || !bulkDeletePreview.allowed}
                  />
                  <label htmlFor="confirm-bulk-transaction-delete" className="leading-5">
                    I understand that the selected transactions will be permanently deleted.
                  </label>
                </div>
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={bulkDeleting}>Cancel</AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                onClick={executeBulkDelete}
                disabled={!bulkDeletePreview?.allowed || !bulkConfirmed || bulkDeleting}
              >
                {bulkDeleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
                {bulkDeleting ? 'Deleting...' : 'Delete selected transactions'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
