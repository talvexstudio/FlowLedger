'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useFlowLedger } from '@/hooks/use-flow-ledger';
import { apiSaveCategory, apiSaveSubcategory } from '@/lib/api';
import type { Category, Subcategory } from '@/lib/types';

type EditableCategory = Category & { subcategories: Subcategory[] };

const createTempId = () => `temp-${Math.random().toString(36).slice(2, 10)}`;
const generateCategoryId = () => `cat_${Math.random().toString(36).slice(2, 10)}`;

const normalizeCategories = (categories: EditableCategory[]) => {
  return categories.map(category => ({
    ...category,
    isActive: category.isActive !== false,
    subcategories: (category.subcategories || []).map(sub => ({
      ...sub,
      isActive: sub.isActive !== false,
      flowType: sub.flowType ?? (category.type === 'income' ? 'Income' : 'Expense'),
    })),
  }));
};

export function CategoriesPanel() {
  const { toast } = useToast();
  const { categories, reloadCategories } = useFlowLedger();
  const [editableCategories, setEditableCategories] = React.useState<EditableCategory[]>([]);
  const [expandedCategoryIds, setExpandedCategoryIds] = React.useState<Set<string>>(new Set());
  const [showAddForm, setShowAddForm] = React.useState(false);
  const [newCategoryName, setNewCategoryName] = React.useState('');
  const [newCategoryType, setNewCategoryType] = React.useState<'expense' | 'income' | 'both'>('expense');
  const [isAddingCategory, setIsAddingCategory] = React.useState(false);

  React.useEffect(() => {
    setEditableCategories(normalizeCategories(categories as EditableCategory[]));
  }, [categories]);

  const updateCategory = (categoryId: string, updater: (cat: EditableCategory) => EditableCategory) => {
    setEditableCategories(prev =>
      prev.map(cat => (cat.id === categoryId ? updater(cat) : cat))
    );
  };

  const handleCategoryNameChange = (categoryId: string, name: string) => {
    updateCategory(categoryId, (cat) => ({ ...cat, name }));
  };

  const handleCategoryActiveChange = (categoryId: string, checked: boolean) => {
    updateCategory(categoryId, (cat) => ({ ...cat, isActive: checked }));
  };

  const handleSubcategoryNameChange = (categoryId: string, subId: string, name: string) => {
    updateCategory(categoryId, (cat) => ({
      ...cat,
      subcategories: cat.subcategories.map(sub =>
        sub.id === subId ? { ...sub, name } : sub
      ),
    }));
  };

  const handleSubcategoryActiveChange = (categoryId: string, subId: string, checked: boolean) => {
    updateCategory(categoryId, (cat) => ({
      ...cat,
      subcategories: cat.subcategories.map(sub =>
        sub.id === subId ? { ...sub, isActive: checked } : sub
      ),
    }));
  };

  const handleSubcategoryFlowTypeChange = (
    categoryId: string,
    subId: string,
    flowType: 'Expense' | 'Income'
  ) => {
    updateCategory(categoryId, (cat) => ({
      ...cat,
      subcategories: cat.subcategories.map(sub =>
        sub.id === subId ? { ...sub, flowType } : sub
      ),
    }));
  };

  const handleAddSubcategory = (categoryId: string) => {
    updateCategory(categoryId, (cat) => ({
      ...cat,
      subcategories: [
        ...cat.subcategories,
        {
          id: createTempId(),
          categoryId: cat.id,
          name: 'New subcategory',
          order: (cat.subcategories?.length || 0) + 1,
          isSystem: false,
          isCustom: true,
          isActive: true,
          flowType: cat.type === 'income' ? 'Income' : 'Expense',
        },
      ],
    }));
  };

  const toggleExpanded = (categoryId: string) => {
    setExpandedCategoryIds(prev => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  const handleAddCategory = async () => {
    const trimmedName = newCategoryName.trim();
    if (!trimmedName) {
      toast({ variant: 'destructive', title: 'Name required', description: 'Please enter a category name.' });
      return;
    }
    const duplicate = editableCategories.some(
      c => c.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (duplicate) {
      toast({ variant: 'destructive', title: 'Duplicate name', description: `A category named "${trimmedName}" already exists.` });
      return;
    }

    setIsAddingCategory(true);
    try {
      const newCategory: Category = {
        id: generateCategoryId(),
        name: trimmedName,
        type: newCategoryType,
        order: editableCategories.length + 1,
        isSystem: false,
        isCustom: true,
        isActive: true,
      };
      await apiSaveCategory(newCategory);
      await reloadCategories();
      setNewCategoryName('');
      setNewCategoryType('expense');
      setShowAddForm(false);
      toast({ title: 'Category created', description: `"${trimmedName}" has been added.` });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Failed to create category', description: (error as Error).message });
    } finally {
      setIsAddingCategory(false);
    }
  };

  const handleSaveAll = async () => {
    try {
      for (const category of editableCategories) {
        const { subcategories, ...categoryData } = category;
        await apiSaveCategory(categoryData);
        for (const subcategory of subcategories) {
          await apiSaveSubcategory(category.id, subcategory);
        }
      }
      await reloadCategories();
      toast({
        title: 'Categories updated',
        description: 'Your category changes have been saved.',
      });
    } catch (error) {
      console.error(error);
      toast({
        variant: 'destructive',
        title: 'Save failed',
        description: 'Could not update categories. Please try again.',
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Categories</CardTitle>
            <CardDescription>
              Manage the categories and subcategories used for classification and budgeting.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowAddForm(v => !v)}>
            {showAddForm ? 'Cancel' : 'Add Category'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {showAddForm && (
          <div className="mb-6 rounded-md border p-4 space-y-3 bg-muted/30">
            <p className="text-sm font-medium">New Category</p>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[180px]">
                <label className="text-xs text-muted-foreground mb-1 block">Name</label>
                <Input
                  placeholder="e.g., Entertainment"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddCategory(); }}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Type</label>
                <Select value={newCategoryType} onValueChange={(v) => setNewCategoryType(v as 'expense' | 'income' | 'both')}>
                  <SelectTrigger className="w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="expense">Expense</SelectItem>
                    <SelectItem value="income">Income</SelectItem>
                    <SelectItem value="both">Both</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleAddCategory} disabled={isAddingCategory}>
                {isAddingCategory ? 'Adding...' : 'Add'}
              </Button>
            </div>
          </div>
        )}

        {editableCategories.length === 0 ? (
          <p className="text-sm text-muted-foreground">No categories available.</p>
        ) : (
          <div className="space-y-4">
            {editableCategories.map((category) => {
              const isExpanded = expandedCategoryIds.has(category.id);
              return (
                <div key={category.id} className="border-b pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Input
                        value={category.name}
                        onChange={(e) => handleCategoryNameChange(category.id, e.target.value)}
                        className="max-w-xs"
                        readOnly={category.isSystem}
                        disabled={category.isSystem}
                      />
                      {category.isSystem && (
                        <span className="text-xs text-muted-foreground whitespace-nowrap">System</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(category.id)}
                        className="text-xs text-muted-foreground underline underline-offset-2"
                      >
                        {isExpanded ? 'Hide subcategories' : 'Show subcategories'}
                      </button>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Active</span>
                        <Switch
                          checked={category.isActive !== false}
                          onCheckedChange={(checked) => handleCategoryActiveChange(category.id, checked)}
                        />
                      </div>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="mt-3 border rounded-md p-2 max-h-48 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Active</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {category.subcategories.map(sub => (
                            <TableRow key={sub.id}>
                              <TableCell>
                                <Input
                                  value={sub.name}
                                  onChange={(e) =>
                                    handleSubcategoryNameChange(category.id, sub.id, e.target.value)
                                  }
                                />
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={sub.flowType || 'Expense'}
                                  onValueChange={(val) =>
                                    handleSubcategoryFlowTypeChange(
                                      category.id,
                                      sub.id,
                                      val as 'Expense' | 'Income'
                                    )
                                  }
                                >
                                  <SelectTrigger className="w-[120px]">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="Expense">Expense</SelectItem>
                                    <SelectItem value="Income">Income</SelectItem>
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <Switch
                                  checked={sub.isActive !== false}
                                  onCheckedChange={(checked) =>
                                    handleSubcategoryActiveChange(category.id, sub.id, checked)
                                  }
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                          <TableRow>
                            <TableCell colSpan={3}>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleAddSubcategory(category.id)}
                              >
                                Add subcategory
                              </Button>
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <Button onClick={handleSaveAll}>Save changes</Button>
        </div>
      </CardContent>
    </Card>
  );
}
