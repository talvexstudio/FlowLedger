'use client';

import React from 'react';
import * as XLSX from 'xlsx';
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
import {
  apiCommitImport,
  apiGetRules,
  apiGetImportTemplates,
  apiSaveImportTemplate,
} from '@/lib/api';
import type { ImportTemplate } from '@/lib/types';
import { ImportResultDialog } from '@/components/import/import-result-dialog';
import {
  collectXlsxRows,
  DEFAULT_IMPORT_DATE_FORMAT,
  getEffectiveImportMapping,
  parseCsvBytes,
  prepareImportTransactions,
  type CsvTextEncoding,
  type ImportFileType,
  type ImportRejectedRow,
  type ParsedImportFile,
} from '@/lib/import-processing';

type FileType = ImportFileType;

const DATE_FORMAT_OPTIONS = [DEFAULT_IMPORT_DATE_FORMAT, 'MM/dd/yyyy', 'yyyy-MM-dd'];
const DECIMAL_SEPARATOR_OPTIONS: Array<',' | '.'> = [',', '.'];
const THOUSANDS_SEPARATOR_OPTIONS: Array<',' | '.' | ' '> = [',', '.', ' '];

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
  const [csvEncoding, setCsvEncoding] = React.useState<CsvTextEncoding | null>(null);
  const [mapping, setMapping] = React.useState<Partial<ImportTemplate['mapping']> | null>(null);

  const [targetAccountId, setTargetAccountId] = React.useState<string>('');
  const [saveAsTemplate, setSaveAsTemplate] = React.useState(false);
  const [newTemplateName, setNewTemplateName] = React.useState('');
  const [isImporting, setIsImporting] = React.useState(false);
  const [importResult, setImportResult] = React.useState<{
    total: number;
    accepted: number;
    pending: number;
    duplicates: number;
    rejectedRows: ImportRejectedRow[];
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
    if (selectedTemplate.defaultAccountId) {
      setTargetAccountId(selectedTemplate.defaultAccountId);
    }
  }, [selectedTemplateId, selectedTemplate]);

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
    setCsvEncoding(null);
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
      try {
        await parseCsvPreview(nextFile);
      } catch (error) {
        toast({
          variant: 'destructive',
          title: 'CSV parsing failed',
          description: error instanceof Error ? error.message : 'The CSV file could not be read.',
        });
      }
      return;
    }

    if (name.endsWith('.xls') || name.endsWith('.xlsx')) {
      setFile(nextFile);
      setFileType('XLSX');
      setCsvEncoding(null);
      await parseXlsxPreview(nextFile);
      return;
    }

    resetFileState();
    toast({
      variant: 'destructive',
      title: 'Unsupported file type',
      description: 'Please upload a CSV or XLSX file.',
    });
  };

  const parseCsvPreview = async (inputFile: File) => {
    const parsed = parseCsvBytes(await inputFile.arrayBuffer());
    if (parsed.globalErrors.length > 0 || parsed.rejectedRows.length > 0) {
      toast({
        variant: 'destructive',
        title: 'CSV parsing warning',
        description: parsed.globalErrors[0]
          ?? `${parsed.rejectedRows.length} row(s) contain CSV formatting errors.`,
      });
    }
    setCsvEncoding(parsed.encoding);
    setHeaderColumns(parsed.headers);
    setPreviewRows(parsed.rows.slice(0, 10).map((row) => row.values));
    setMapping(
      selectedTemplate ? selectedTemplate.mapping : { dateField: '', descriptionField: '' }
    );
  };

  const parseXlsxPreview = async (inputFile: File) => {
    const data = await inputFile.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
    const parsed = collectXlsxRows(json);
    const headers = json[0]?.map((header) => String(header ?? '').trim()).filter(Boolean) ?? [];

    setHeaderColumns(headers);
    setPreviewRows(parsed.rows.slice(0, 10).map((row) => row.values));
    setMapping(
      selectedTemplate ? selectedTemplate.mapping : { dateField: '', descriptionField: '' }
    );
    if (parsed.globalErrors.length > 0) {
      toast({
        variant: 'destructive',
        title: 'XLSX parsing failed',
        description: parsed.globalErrors[0],
      });
    }
  };

  const parseFullCsv = async (inputFile: File): Promise<ParsedImportFile> =>
    parseCsvBytes(await inputFile.arrayBuffer());

  const parseFullXlsx = async (inputFile: File): Promise<ParsedImportFile> => {
    const data = await inputFile.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
    return collectXlsxRows(json);
  };

  const parseFullFile = async (
    inputFile: File,
    type: FileType
  ): Promise<ParsedImportFile> => {
    if (type === 'CSV') return parseFullCsv(inputFile);
    return parseFullXlsx(inputFile);
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
      const parsedFile = await parseFullFile(file, fileType);
      if (parsedFile.globalErrors.length > 0) {
        throw new Error(parsedFile.globalErrors.join(' '));
      }

      const rules = await apiGetRules(workspaceId);
      const effectiveMapping = getEffectiveImportMapping(
        mapping as ImportTemplate['mapping']
      );
      const prepared = prepareImportTransactions(
        parsedFile.rows,
        effectiveMapping,
        fileType,
        { workspaceId, accountId: targetAccountId },
        rules,
        categories
      );
      const rejectedRows = [...parsedFile.rejectedRows, ...prepared.rejectedRows]
        .sort((a, b) => a.rowNumber - b.rowNumber);
      const totalRows = prepared.transactions.length + rejectedRows.length;

      if (prepared.transactions.length === 0) {
        setImportResult({
          total: totalRows,
          accepted: 0,
          pending: 0,
          duplicates: 0,
          rejectedRows,
        });
        setResultDialogOpen(true);
        toast({
          variant: 'destructive',
          title: 'No transactions imported',
          description: `${rejectedRows.length} row(s) were rejected. Review the reported reasons and mapping.`,
        });
        return;
      }

      const { session, transactions: created } = await apiCommitImport(
        workspaceId,
        {
          accountId: targetAccountId,
          createdAt: new Date(),
          fileName: file.name,
          sourceType: fileType,
          template: selectedTemplateId === 'generic'
            ? '(ad-hoc)'
            : (templates.find((template) => template.id === selectedTemplateId)?.name || '(unknown)'),
          transactionCount: prepared.transactions.length,
        },
        prepared.transactions
      );

      await reloadTransactions();
      const pendingCount = created.filter((tx) => tx.needsReview !== false).length;
      const duplicateCount = created.filter((tx) => tx.isPotentialDuplicate).length;
      setImportResult({
        total: totalRows,
        accepted: created.length,
        pending: pendingCount,
        duplicates: duplicateCount,
        rejectedRows,
        importId: session.id,
      });
      setResultDialogOpen(true);

      toast({
        title: 'Import completed',
        description: `${created.length} imported, ${pendingCount} pending review, ${rejectedRows.length} rejected.`,
      });

      if (saveAsTemplate && newTemplateName.trim()) {
        try {
          await apiSaveImportTemplate(workspaceId, {
            name: newTemplateName.trim(),
            description: `${fileType} template created from ${file.name}`,
            sourceType: fileType,
            headerSignature: headerColumns,
            mapping: effectiveMapping,
            defaultAccountId: targetAccountId,
          });
          const savedTemplates = await apiGetImportTemplates(workspaceId);
          setTemplates(savedTemplates);
        } catch (templateError) {
          console.error(templateError);
          toast({
            variant: 'destructive',
            title: 'Import completed, template not saved',
            description: 'Transactions were imported safely, but the reusable mapping could not be saved.',
          });
        }
      }

      if (pendingCount > 0) {
        toast({
          title: 'Review required',
          description: `${pendingCount} imported transaction(s) need review before affecting reports.`,
        });
      }

      resetFileState();
      setSaveAsTemplate(false);
      setNewTemplateName('');
    } catch (error) {
      console.error(error);
      toast({
        variant: 'destructive',
        title: 'Import failed',
        description: error instanceof Error
          ? error.message
          : 'Something went wrong while importing this file.',
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
          {fileType === 'CSV' && csvEncoding && (
            <p className="text-xs text-muted-foreground">CSV encoding: {csvEncoding}</p>
          )}

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

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                              thousandsSeparator: val as ',' | '.' | ' ',
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
                              {option === ' ' ? 'Space' : option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
          accepted={importResult.accepted}
          pending={importResult.pending}
          duplicates={importResult.duplicates}
          rejectedRows={importResult.rejectedRows}
          onReviewNow={handleReviewNow}
        />
      )}
    </div>
  );
}
