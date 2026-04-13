'use client';

import React from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { parse } from 'date-fns';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FileUploader } from '@/components/import/file-uploader';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFlowLedger } from '@/hooks/use-flow-ledger';
import { useToast } from '@/hooks/use-toast';
import { applyRulesToTransaction } from '@/lib/utils/rule-utils';
import {
  apiGetRules,
  apiGetImportTemplates,
  apiSaveImportSession,
  apiSaveImportTemplate,
  apiSaveTransaction,
  apiFindMatchingTemplate,
} from '@/lib/api';
import type { Category, ImportTemplate, Subcategory, Transaction } from '@/lib/types';
import { ImportResultDialog } from '@/components/import/import-result-dialog';

type FileType = 'CSV' | 'XLSX';

const DATE_FORMAT_OPTIONS = ['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd'];
const DECIMAL_SEPARATOR_OPTIONS: Array<',' | '.'> = [',', '.'];
const THOUSANDS_SEPARATOR_OPTIONS: Array<',' | '.'> = [',', '.'];

export default function ImportPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { workspaceId, accounts, categories, reloadTransactions } = useFlowLedger();

  const [templates, setTemplates] = React.useState<ImportTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string | 'generic'>('generic');

  const [file, setFile] = React.useState<File | null>(null);
  const [fileType, setFileType] = React.useState<FileType | null>(null);
  const [headerColumns, setHeaderColumns] = React.useState<string[]>([]);
  const [previewRows, setPreviewRows] = React.useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = React.useState<Partial<ImportTemplate['mapping']> | null>(null);

  const [targetAccountId, setTargetAccountId] = React.useState<string>('');
  const [saveAsTemplate, setSaveAsTemplate] = React.useState(false);
  const [newTemplateName, setNewTemplateName] = React.useState('');
  const [isImporting, setIsImporting] = React.useState(false);
  const [importResult, setImportResult] = React.useState<{
    total: number;
    pending: number;
    duplicates: number;
    importId?: string;
  } | null>(null);
  const [resultDialogOpen, setResultDialogOpen] = React.useState(false);

  const selectedTemplate = React.useMemo(
    () => templates.find((tpl) => tpl.id === selectedTemplateId) || null,
    [templates, selectedTemplateId]
  );

  React.useEffect(() => {
    const loadTemplates = async () => {
      if (!workspaceId) return;
      try {
        const tpl = await apiGetImportTemplates(workspaceId);
        setTemplates(tpl);
      } catch (error) {
        console.error(error);
      }
    };
    loadTemplates();
  }, [workspaceId]);

  React.useEffect(() => {
    if (selectedTemplateId === 'generic') return;
    if (!selectedTemplate) return;
    setMapping(selectedTemplate.mapping);
    if (!targetAccountId && selectedTemplate.defaultAccountId) {
      setTargetAccountId(selectedTemplate.defaultAccountId);
    }
  }, [selectedTemplateId, selectedTemplate, targetAccountId]);

  const updateMapping = (updates: Partial<ImportTemplate['mapping']>) => {
    setMapping((prev) => ({
      ...(prev || { dateField: '', descriptionField: '' }),
      ...updates,
    }));
  };

  const resetFileState = () => {
    setFile(null);
    setFileType(null);
    setHeaderColumns([]);
    setPreviewRows([]);
    setMapping(null);
  };

  const handleFileSelected = async (nextFile: File | null) => {
    if (!nextFile) {
      resetFileState();
      return;
    }

    const name = nextFile.name.toLowerCase();
    if (name.endsWith('.csv')) {
      setFile(nextFile);
      setFileType('CSV');
      parseCsvPreview(nextFile);
      return;
    }

    if (name.endsWith('.xls') || name.endsWith('.xlsx')) {
      setFile(nextFile);
      setFileType('XLSX');
      parseXlsxPreview(nextFile);
      return;
    }

    resetFileState();
    toast({
      variant: 'destructive',
      title: 'Unsupported file type',
      description: 'Please upload a CSV or XLSX file.',
    });
  };

  const parseCsvPreview = (inputFile: File) => {
    Papa.parse(inputFile, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = (results.data || []) as Record<string, unknown>[];
        const headers = results.meta.fields || [];
        setHeaderColumns(headers);
        setPreviewRows(rows.slice(0, 10));
        setMapping(
          selectedTemplate ? selectedTemplate.mapping : { dateField: '', descriptionField: '' }
        );
      },
    });
  };

  const parseXlsxPreview = async (inputFile: File) => {
    const data = await inputFile.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

    if (!json.length) {
      setHeaderColumns([]);
      setPreviewRows([]);
      return;
    }

    const [headerRow, ...rows] = json;
    const headers = headerRow.map((h) => String(h || ''));
    const rowObjects = rows.slice(0, 10).map((row) => {
      const obj: Record<string, unknown> = {};
      headers.forEach((h, idx) => {
        obj[h] = row[idx];
      });
      return obj;
    });

    setHeaderColumns(headers);
    setPreviewRows(rowObjects);
    setMapping(
      selectedTemplate ? selectedTemplate.mapping : { dateField: '', descriptionField: '' }
    );
  };

  const parseFullCsv = (inputFile: File): Promise<Record<string, unknown>[]> =>
    new Promise((resolve, reject) => {
      Papa.parse(inputFile, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: (results) => resolve(results.data as Record<string, unknown>[]),
        error: reject,
      });
    });

  const parseFullXlsx = async (inputFile: File): Promise<Record<string, unknown>[]> => {
    const data = await inputFile.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

    if (!json.length) {
      return [];
    }

    const [headerRow, ...rows] = json;
    const headers = headerRow.map((h) => String(h || ''));
    return rows
      .map((row) => {
        const obj: Record<string, unknown> = {};
        headers.forEach((h, idx) => {
          obj[h] = row[idx];
        });
        return obj;
      })
      .filter((row) => Object.values(row).some((value) => value !== null && value !== undefined && value !== ''));
  };

  const parseFullFile = async (
    inputFile: File,
    type: FileType
  ): Promise<Record<string, unknown>[]> => {
    if (type === 'CSV') return parseFullCsv(inputFile);
    return parseFullXlsx(inputFile);
  };

  const parseDateValue = (
    value: unknown,
    formatString?: string,
    type?: FileType
  ): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'number' && type === 'XLSX') {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30)).getTime();
      return new Date(excelEpoch + value * 86400000);
    }
    const text = String(value).trim();
    if (!text) return null;
    if (formatString) {
      const parsed = parse(text, formatString, new Date());
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    const fallback = new Date(text);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  };

  const parseAmountValue = (
    value: unknown,
    options?: ImportTemplate['mapping']['amountOptions']
  ): number => {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return value;
    let raw = String(value).trim();
    if (!raw) return 0;
    let negative = false;
    if (raw.includes('(') && raw.includes(')')) {
      negative = true;
      raw = raw.replace(/[()]/g, '');
    }
    if (raw.startsWith('-')) {
      negative = true;
      raw = raw.slice(1);
    }

    const decimalSeparator = options?.decimalSeparator || '.';
    const thousandsSeparator = options?.thousandsSeparator || ',';
    if (thousandsSeparator) {
      const regex = new RegExp(`\\${thousandsSeparator}`, 'g');
      raw = raw.replace(regex, '');
    }
    if (decimalSeparator !== '.') {
      raw = raw.replace(decimalSeparator, '.');
    }
    raw = raw.replace(/[^0-9.-]/g, '');
    const parsed = Number.parseFloat(raw);
    if (Number.isNaN(parsed)) return 0;
    return negative ? -parsed : parsed;
  };

  const buildTransactionFromRow = (
    row: Record<string, unknown>,
    map: ImportTemplate['mapping'],
    type: FileType,
    context: {
      workspaceId: string;
      accountId: string;
      importId: string;
      fileName: string;
    }
  ): Partial<Transaction> | null => {
    const date = parseDateValue(row[map.dateField], map.dateFormat, type);
    if (!date) return null;
    const descriptionRaw = row[map.descriptionField];
    const description = descriptionRaw ? String(descriptionRaw).trim() : '';
    if (!description) return null;
    const rawDescription = map.rawDescriptionField
      ? String(row[map.rawDescriptionField] ?? '').trim()
      : description;

    let amount = 0;
    if (map.amountField) {
      amount = parseAmountValue(row[map.amountField], map.amountOptions);
    } else {
      const debit = map.debitField ? parseAmountValue(row[map.debitField], map.amountOptions) : 0;
      const credit = map.creditField ? parseAmountValue(row[map.creditField], map.amountOptions) : 0;
      amount = credit - debit;
    }

    const txType: Transaction['type'] = amount < 0 ? 'Expense' : 'Income';
    const balanceAfter = map.balanceField
      ? parseAmountValue(row[map.balanceField], map.amountOptions)
      : undefined;

    return {
      workspaceId: context.workspaceId,
      accountId: context.accountId,
      date,
      description,
      rawDescription,
      amountOriginal: amount,
      currencyOriginal: 'EUR',
      amountBase: amount,
      balanceAfter,
      type: txType,
      importId: context.importId,
      needsReview: true,
      isInternalTransfer: false,
      isPotentialDuplicate: false,
      isInconsistent: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  };

  const applyDefaultTypeFromSubcategory = (
    tx: Partial<Transaction>,
    categoryList: (Category & { subcategories: Subcategory[] })[]
  ): Partial<Transaction> => {
    if (!tx.subcategoryId) return tx;
    const category = categoryList.find((cat) =>
      cat.subcategories?.some((sub) => sub.id === tx.subcategoryId)
    );
    const subcategory = category?.subcategories?.find((sub) => sub.id === tx.subcategoryId);
    if (subcategory?.flowType) {
      return {
        ...tx,
        type: subcategory.flowType,
      };
    }
    return tx;
  };

  const isFullyClassified = (
    tx: Partial<Transaction>,
    categoryList: (Category & { subcategories: Subcategory[] })[]
  ) => {
    if (!tx.categoryId || !tx.type) return false;
    const category = categoryList.find((cat) => cat.id === tx.categoryId);
    if (!category) return false;
    const requiresSubcategory = (category.subcategories || []).length > 0;
    if (requiresSubcategory && !tx.subcategoryId) return false;
    return true;
  };

  const handleImport = async () => {
    if (!workspaceId || !file || !fileType || !mapping || !targetAccountId) {
      toast({
        variant: 'destructive',
        title: 'Missing information',
        description: 'Please select a file, mapping, and target account.',
      });
      return;
    }

    if (!mapping.dateField || !mapping.descriptionField) {
      toast({
        variant: 'destructive',
        title: 'Missing mapping',
        description: 'Please map the date and description columns.',
      });
      return;
    }

    if (!mapping.amountField && !mapping.debitField && !mapping.creditField) {
      toast({
        variant: 'destructive',
        title: 'Missing amount mapping',
        description: 'Please map an amount column or debit/credit columns.',
      });
      return;
    }

    if (saveAsTemplate && !newTemplateName.trim()) {
      toast({
        variant: 'destructive',
        title: 'Template name required',
        description: 'Enter a name to save this template.',
      });
      return;
    }

    setIsImporting(true);
    try {
      const rows = await parseFullFile(file, fileType);

      const session = await apiSaveImportSession(workspaceId, {
        workspaceId,
        accountId: targetAccountId,
        createdAt: new Date(),
        fileName: file.name,
        sourceType: fileType,
        template: selectedTemplateId === 'generic'
          ? '(ad-hoc)'
          : (templates.find(t => t.id === selectedTemplateId)?.name || '(unknown)'),
        transactionCount: rows.length,
      });

      if (saveAsTemplate && newTemplateName.trim()) {
        await apiSaveImportTemplate(workspaceId, {
          name: newTemplateName.trim(),
          description: `${fileType} template created from ${file.name}`,
          sourceType: fileType,
          headerSignature: headerColumns,
          mapping: mapping as ImportTemplate['mapping'],
          defaultAccountId: targetAccountId,
        });
        const tpl = await apiGetImportTemplates(workspaceId);
        setTemplates(tpl);
      }

      const rules = await apiGetRules(workspaceId);
      const baseContext = {
        workspaceId,
        accountId: targetAccountId,
        importId: session.id,
        fileName: file.name,
      };

      let createdCount = 0;
      const created: Transaction[] = [];
      for (const row of rows) {
        const baseTx = buildTransactionFromRow(row, mapping as ImportTemplate['mapping'], fileType, baseContext);
        if (!baseTx) continue;
          const withRules = applyRulesToTransaction(baseTx, rules);
          const withType = applyDefaultTypeFromSubcategory(withRules, categories);
        const isClassified = isFullyClassified(withType, categories);
        const saved = await apiSaveTransaction(workspaceId, {
          ...withType,
          workspaceId,
          accountId: targetAccountId,
          needsReview: !isClassified,
          importId: session.id,
        });
        createdCount += 1;
        created.push(saved as Transaction);
      }

      await reloadTransactions();
      const pendingCount = created.filter((tx) => tx.needsReview !== false).length;
      const duplicateCount = created.filter((tx) => tx.isPotentialDuplicate).length;
      setImportResult({
        total: createdCount,
        pending: pendingCount,
        duplicates: duplicateCount,
        importId: session.id,
      });

      if (createdCount > 0 && pendingCount === 0) {
        toast({
          title: 'Import completed',
          description: `Imported ${createdCount} transaction(s). All of them were classified by your existing rules.`,
        });
      } else if (createdCount > 0) {
        toast({
          title: 'Import completed',
          description: `Imported ${createdCount} transaction(s). ${pendingCount} still need classification.`,
        });
        setResultDialogOpen(true);
      }

      resetFileState();
      setSaveAsTemplate(false);
      setNewTemplateName('');
    } catch (error) {
      console.error(error);
      toast({
        variant: 'destructive',
        title: 'Import failed',
        description: 'Something went wrong while importing this file.',
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleReviewNow = () => {
    router.push('/dashboard');
  };

  const accountOptions = accounts.filter((acc) => !acc.archived);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Import Transactions</h1>
        <p className="text-muted-foreground">Upload a bank statement file to add new transactions.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>New Import</CardTitle>
          <CardDescription>Select an import template and upload your file.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="template">Import Template</Label>
            <Select value={selectedTemplateId} onValueChange={(val) => setSelectedTemplateId(val as 'generic' | string)}>
              <SelectTrigger id="template">
                <SelectValue placeholder="Select a template..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="generic">Generic CSV/XLSX</SelectItem>
                {templates.map((tpl) => (
                  <SelectItem key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Templates help map file columns correctly.</p>
          </div>
          <FileUploader file={file} onFileSelected={handleFileSelected} />

          {headerColumns.length > 0 && (
            <>
              <Card className="border-dashed">
                <CardHeader>
                  <CardTitle>Column Mapping</CardTitle>
                  <CardDescription>Map the file columns to transaction fields.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Date column</Label>
                      <Select
                        value={mapping?.dateField || ''}
                        onValueChange={(val) => updateMapping({ dateField: val })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select date column" />
                        </SelectTrigger>
                        <SelectContent>
                          {headerColumns.map((col) => (
                            <SelectItem key={col} value={col}>
                              {col}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Date format</Label>
                      <Select
                        value={mapping?.dateFormat || DATE_FORMAT_OPTIONS[0]}
                        onValueChange={(val) => updateMapping({ dateFormat: val })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DATE_FORMAT_OPTIONS.map((formatOption) => (
                            <SelectItem key={formatOption} value={formatOption}>
                              {formatOption}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Description column</Label>
                      <Select
                        value={mapping?.descriptionField || ''}
                        onValueChange={(val) => updateMapping({ descriptionField: val })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select description column" />
                        </SelectTrigger>
                        <SelectContent>
                          {headerColumns.map((col) => (
                            <SelectItem key={col} value={col}>
                              {col}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Raw description column (optional)</Label>
                      <Select
                        value={mapping?.rawDescriptionField || '__none__'}
                        onValueChange={(val) =>
                          updateMapping({ rawDescriptionField: val === '__none__' ? undefined : val })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="(none)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">(none)</SelectItem>
                          {headerColumns.map((col) => (
                            <SelectItem key={col} value={col}>
                              {col}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Amount column (optional)</Label>
                      <Select
                        value={mapping?.amountField || '__none__'}
                        onValueChange={(val) =>
                          updateMapping({ amountField: val === '__none__' ? undefined : val })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select amount column" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">(none)</SelectItem>
                          {headerColumns.map((col) => (
                            <SelectItem key={col} value={col}>
                              {col}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Balance column (optional)</Label>
                      <Select
                        value={mapping?.balanceField || '__none__'}
                        onValueChange={(val) =>
                          updateMapping({ balanceField: val === '__none__' ? undefined : val })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="(none)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">(none)</SelectItem>
                          {headerColumns.map((col) => (
                            <SelectItem key={col} value={col}>
                              {col}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Debit column (optional)</Label>
                      <Select
                        value={mapping?.debitField || '__none__'}
                        onValueChange={(val) =>
                          updateMapping({ debitField: val === '__none__' ? undefined : val })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select debit column" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">(none)</SelectItem>
                          {headerColumns.map((col) => (
                            <SelectItem key={col} value={col}>
                              {col}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Credit column (optional)</Label>
                      <Select
                        value={mapping?.creditField || '__none__'}
                        onValueChange={(val) =>
                          updateMapping({ creditField: val === '__none__' ? undefined : val })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select credit column" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">(none)</SelectItem>
                          {headerColumns.map((col) => (
                            <SelectItem key={col} value={col}>
                              {col}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label>Decimal separator</Label>
                      <Select
                        value={mapping?.amountOptions?.decimalSeparator || DECIMAL_SEPARATOR_OPTIONS[1]}
                        onValueChange={(val) =>
                          updateMapping({
                            amountOptions: {
                              ...(mapping?.amountOptions || {}),
                              decimalSeparator: val as ',' | '.',
                            },
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DECIMAL_SEPARATOR_OPTIONS.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Thousands separator</Label>
                      <Select
                        value={mapping?.amountOptions?.thousandsSeparator || THOUSANDS_SEPARATOR_OPTIONS[0]}
                        onValueChange={(val) =>
                          updateMapping({
                            amountOptions: {
                              ...(mapping?.amountOptions || {}),
                              thousandsSeparator: val as ',' | '.',
                            },
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {THOUSANDS_SEPARATOR_OPTIONS.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2 pt-6">
                      <Checkbox
                        checked={mapping?.amountOptions?.alreadySigned || false}
                        onCheckedChange={(checked) =>
                          updateMapping({
                            amountOptions: {
                              ...(mapping?.amountOptions || {}),
                              alreadySigned: Boolean(checked),
                            },
                          })
                        }
                        id="alreadySigned"
                      />
                      <Label htmlFor="alreadySigned">Amounts already signed</Label>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Target account</Label>
                      <Select value={targetAccountId} onValueChange={setTargetAccountId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select account" />
                        </SelectTrigger>
                        <SelectContent>
                          {accountOptions.map((acc) => (
                            <SelectItem key={acc.id} value={acc.id}>
                              {acc.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Checkbox
                      checked={saveAsTemplate}
                      onCheckedChange={(checked) => setSaveAsTemplate(Boolean(checked))}
                      id="saveTemplate"
                    />
                    <Label htmlFor="saveTemplate" className="text-sm">
                      Save this mapping as a template
                    </Label>
                    {saveAsTemplate && (
                      <Input
                        className="ml-2 max-w-xs"
                        placeholder="Template name"
                        value={newTemplateName}
                        onChange={(e) => setNewTemplateName(e.target.value)}
                      />
                    )}
                  </div>
                </CardContent>
              </Card>

              {previewRows.length > 0 && (
                <Card className="border-muted">
                  <CardHeader>
                    <CardTitle>Preview</CardTitle>
                    <CardDescription>First 10 rows from the file.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {headerColumns.map((col) => (
                              <TableHead key={col}>{col}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {previewRows.map((row, rowIndex) => (
                            <TableRow key={rowIndex}>
                              {headerColumns.map((col) => (
                                <TableCell key={`${rowIndex}-${col}`}>
                                  {row[col] !== undefined && row[col] !== null ? String(row[col]) : ''}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </CardContent>
        <CardFooter>
          <Button className="w-full" onClick={handleImport} disabled={isImporting}>
            {isImporting ? 'Importing...' : 'Import Transactions'}
          </Button>
        </CardFooter>
      </Card>
      {importResult && (
        <ImportResultDialog
          open={resultDialogOpen}
          onOpenChange={setResultDialogOpen}
          total={importResult.total}
          pending={importResult.pending}
          duplicates={importResult.duplicates}
          onReviewNow={handleReviewNow}
        />
      )}
    </div>
  );
}
