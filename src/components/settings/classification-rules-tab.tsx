'use client';

import React from 'react';
import { format } from 'date-fns';
import { Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useFlowLedger } from '@/hooks/use-flow-ledger';
import { apiDeleteRule, apiGetRules, apiSaveRule } from '@/lib/api';
import type { ClassificationRule, Transaction } from '@/lib/types';

const ANY_VALUE = '__any__';

export function ClassificationRulesTab() {
  const { toast } = useToast();
  const { workspaceId, accounts, categories } = useFlowLedger();
  const [editableRules, setEditableRules] = React.useState<ClassificationRule[]>([]);
  const [isSaving, setIsSaving] = React.useState(false);

  const loadRules = React.useCallback(async () => {
    if (!workspaceId) return;
    try {
      const data = await apiGetRules(workspaceId);
      const normalized = data.map((rule) => ({
        ...rule,
        match: rule.match ?? {},
        action: rule.action ?? {},
      }));
      setEditableRules(normalized);
    } catch (error) {
      console.error(error);
      toast({
        variant: 'destructive',
        title: 'Failed to load rules',
        description: 'Could not load classification rules.',
      });
    }
  }, [workspaceId, toast]);

  React.useEffect(() => {
    loadRules();
  }, [loadRules]);

  const handleDeleteRule = async (ruleId: string) => {
    if (!workspaceId) return;
    try {
      await apiDeleteRule(workspaceId, ruleId);
      await loadRules();
      toast({
        title: 'Rule deleted',
        description: 'The classification rule has been removed.',
      });
    } catch (error) {
      console.error(error);
      toast({
        variant: 'destructive',
        title: 'Delete failed',
        description: 'Could not delete the classification rule.',
      });
    }
  };

  const handleRuleMatchChange = (ruleId: string, patch: Partial<ClassificationRule['match']>) => {
    setEditableRules((prev) =>
      prev.map((rule) =>
        rule.id === ruleId
          ? {
              ...rule,
              match: {
                ...rule.match,
                ...patch,
              },
            }
          : rule
      )
    );
  };

  const handleRuleActionChange = (ruleId: string, patch: Partial<ClassificationRule['action']>) => {
    setEditableRules((prev) =>
      prev.map((rule) =>
        rule.id === ruleId
          ? {
              ...rule,
              action: {
                ...rule.action,
                ...patch,
              },
            }
          : rule
      )
    );
  };

  const formatCreatedAt = (value: Date | string | undefined) => {
    if (!value) return '--';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return format(date, 'PP');
  };

  const getCategoryOptions = (rule: ClassificationRule) => {
    const activeCategories = categories.filter((category) => category.isActive !== false);
    if (!rule.action.categoryId) {
      return activeCategories;
    }
    const selected = categories.find((category) => category.id === rule.action.categoryId);
    if (!selected) {
      return activeCategories;
    }
    if (activeCategories.some((category) => category.id === selected.id)) {
      return activeCategories;
    }
    return [...activeCategories, selected];
  };

  const getSubcategoryOptions = (rule: ClassificationRule) => {
    if (!rule.action.categoryId) {
      return [];
    }
    const category = categories.find((cat) => cat.id === rule.action.categoryId);
    if (!category) {
      return [];
    }
    const activeSubs = category.subcategories.filter((sub) => sub.isActive !== false);
    if (!rule.action.subcategoryId) {
      return activeSubs;
    }
    const selected = category.subcategories.find((sub) => sub.id === rule.action.subcategoryId);
    if (!selected) {
      return activeSubs;
    }
    if (activeSubs.some((sub) => sub.id === selected.id)) {
      return activeSubs;
    }
    return [...activeSubs, selected];
  };

  const handleSaveRules = async () => {
    if (!workspaceId) return;
    setIsSaving(true);
    try {
      for (const rule of editableRules) {
        await apiSaveRule(workspaceId, {
          ...rule,
          workspaceId: rule.workspaceId || workspaceId,
        });
      }
      await loadRules();
      toast({
        title: 'Rules updated',
        description: 'Your classification rules have been saved.',
      });
    } catch (error) {
      console.error(error);
      toast({
        variant: 'destructive',
        title: 'Failed to save rules',
        description: 'Something went wrong while saving your rules.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Classification Rules</CardTitle>
        <CardDescription>
          Rules created from your past edits. They help pre-fill future transactions.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {editableRules.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No rules defined yet. Edit transactions and enable &quot;Create Classification Rule&quot; to generate them.
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description contains</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Subcategory</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {editableRules.map((rule) => {
                  const categoryOptions = getCategoryOptions(rule);
                  const subcategoryOptions = getSubcategoryOptions(rule);
                  return (
                    <TableRow key={rule.id}>
                      <TableCell>
                        <Input
                          value={rule.match.descriptionContains ?? ''}
                          onChange={(event) =>
                            handleRuleMatchChange(rule.id, {
                              descriptionContains: event.target.value,
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={rule.match.accountId ?? ANY_VALUE}
                          onValueChange={(value) =>
                            handleRuleMatchChange(rule.id, {
                              accountId: value === ANY_VALUE ? undefined : value,
                            })
                          }
                        >
                          <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Any account" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={ANY_VALUE}>Any account</SelectItem>
                            {accounts.map((account) => (
                              <SelectItem key={account.id} value={account.id}>
                                {account.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={rule.action.categoryId ?? ANY_VALUE}
                          onValueChange={(value) =>
                            handleRuleActionChange(rule.id, {
                              categoryId: value === ANY_VALUE ? undefined : value,
                              subcategoryId: undefined,
                            })
                          }
                        >
                          <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Any category" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={ANY_VALUE}>Any category</SelectItem>
                            {categoryOptions.map((category) => (
                              <SelectItem key={category.id} value={category.id}>
                                {category.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={rule.action.subcategoryId ?? ANY_VALUE}
                          onValueChange={(value) =>
                            handleRuleActionChange(rule.id, {
                              subcategoryId: value === ANY_VALUE ? undefined : value,
                            })
                          }
                          disabled={!rule.action.categoryId}
                        >
                          <SelectTrigger className="w-[200px]">
                            <SelectValue placeholder="Any subcategory" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={ANY_VALUE}>Any subcategory</SelectItem>
                            {subcategoryOptions.map((subcategory) => (
                              <SelectItem key={subcategory.id} value={subcategory.id}>
                                {subcategory.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={rule.action.type ?? ANY_VALUE}
                          onValueChange={(value) =>
                            handleRuleActionChange(rule.id, {
                              type: value === ANY_VALUE ? undefined : (value as Transaction['type']),
                            })
                          }
                        >
                          <SelectTrigger className="w-[160px]">
                            <SelectValue placeholder="Any type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={ANY_VALUE}>Any type</SelectItem>
                            <SelectItem value="Expense">Expense</SelectItem>
                            <SelectItem value="Income">Income</SelectItem>
                            <SelectItem value="InternalTransfer">Internal transfer</SelectItem>
                            <SelectItem value="Adjustment">Adjustment</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>{formatCreatedAt(rule.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" disabled={!workspaceId}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete rule</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will remove this classification rule. Future transactions will no longer be auto-categorised by it. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => handleDeleteRule(rule.id)}
                              >
                                Delete rule
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="mt-4 flex justify-end">
              <Button onClick={handleSaveRules} disabled={!workspaceId || isSaving}>
                {isSaving ? 'Saving...' : 'Save changes'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
