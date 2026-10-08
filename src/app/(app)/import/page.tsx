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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFlowLedger } from '@/hooks/use-flow-ledger';
import { useToast } from '@/hooks/use-toast';
import {
  apiCommitImport,
  apiDetectPdfStatement,
  apiExtractPdfStatement,
  apiFindMatchingTemplate,
  apiGetPdfTemplates,
  apiGetRules,
  apiGetImportTemplates,
  PdfExtractionApiError,
  apiSaveImportTemplate,
} from '@/lib/api';
import type { ImportTemplate } from '@/lib/types';
import { detectImportFileType, getImportFlowStage } from '@/lib/import-file-flow';
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
import {
  adaptPdfExtraction,
  PdfImportAdapterError,
  PDF_IMPORT_FIELDS,
} from '@/lib/pdf-import/adapter';
import { getPdfExtractionErrorMessage } from '@/lib/pdf-import/errors';
import {
  evaluatePdfReconciliation,
  reducePdfAcknowledgement,
} from '@/lib/pdf-import/reconciliation';
import type {
  PdfExtractionReport,
  PdfParserDetectionResult,
  PdfTemplateSummary,
} from '@/lib/pdf-import/types';

type FileType = ImportFileType;

const DATE_FORMAT_OPTIONS = [DEFAULT_IMPORT_DATE_FORMAT, 'MM/dd/yyyy', 'yyyy-MM-dd'];
const DECIMAL_SEPARATOR_OPTIONS: Array<',' | '.'> = [',', '.'];
const THOUSANDS_SEPARATOR_OPTIONS: Array<',' | '.' | ' '> = [',', '.', ' '];
const PDF_PREVIEW_COLUMNS = [
  PDF_IMPORT_FIELDS.primaryDate,
  PDF_IMPORT_FIELDS.postingDate,
  PDF_IMPORT_FIELDS.valueDate,
  PDF_IMPORT_FIELDS.description,
  PDF_IMPORT_FIELDS.amount,
  PDF_IMPORT_FIELDS.debit,
  PDF_IMPORT_FIELDS.credit,
  PDF_IMPORT_FIELDS.balance,
  PDF_IMPORT_FIELDS.page,
];
const formatEur = (value: number | null | undefined) =>
  value === null || value === undefined
    ? 'Unavailable'
    : new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(value);

export default function ImportPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { workspaceId, accounts, categories, reloadTransactions } = useFlowLedger();

  const [templates, setTemplates] = React.useState<ImportTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string | 'manual'>('manual');
  const [pdfTemplates, setPdfTemplates] = React.useState<PdfTemplateSummary[]>([]);
  const [selectedPdfTemplateId, setSelectedPdfTemplateId] = React.useState('');
  const [pdfDetection, setPdfDetection] = React.useState<PdfParserDetectionResult | null>(null);
  const [isDetectingPdf, setIsDetectingPdf] = React.useState(false);
  const [showManualPdfParsers, setShowManualPdfParsers] = React.useState(false);

  const [file, setFile] = React.useState<File | null>(null);
  const [fileType, setFileType] = React.useState<FileType | null>(null);
  const [headerColumns, setHeaderColumns] = React.useState<string[]>([]);
  const [previewRows, setPreviewRows] = React.useState<Record<string, unknown>[]>([]);
  const [csvEncoding, setCsvEncoding] = React.useState<CsvTextEncoding | null>(null);
  const [mapping, setMapping] = React.useState<Partial<ImportTemplate['mapping']> | null>(null);
  const [pdfReport, setPdfReport] = React.useState<PdfExtractionReport | null>(null);
  const [pdfParsedFile, setPdfParsedFile] = React.useState<ParsedImportFile | null>(null);
  const [isExtractingPdf, setIsExtractingPdf] = React.useState(false);
  const [pdfAcknowledgement, dispatchPdfAcknowledgement] = React.useReducer(
    reducePdfAcknowledgement,
    { acknowledged: false, fileKey: null, templateId: null }
  );

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
  const importEpochRef = React.useRef(0);

  const pdfReconciliationGate = React.useMemo(
    () => pdfReport
      ? evaluatePdfReconciliation(pdfReport.reconciliation, pdfAcknowledgement.acknowledged)
      : null,
    [pdfReport, pdfAcknowledgement.acknowledged]
  );

  const selectedTemplate = React.useMemo(
    () => templates.find((tpl) => tpl.id === selectedTemplateId) || null,
    [templates, selectedTemplateId]
  );
  const matchedPdfCandidates = React.useMemo(
    () => pdfDetection?.candidates.filter((candidate) => candidate.matched) ?? [],
    [pdfDetection]
  );
  const flowStage = getImportFlowStage(fileType);

  const clearTransientImportState = React.useCallback(() => {
    importEpochRef.current += 1;
    setSelectedTemplateId('manual');
    setSelectedPdfTemplateId('');
    setPdfDetection(null);
    setIsDetectingPdf(false);
    setShowManualPdfParsers(false);
    setFile(null);
    setFileType(null);
    setHeaderColumns([]);
    setPreviewRows([]);
    setCsvEncoding(null);
    setMapping(null);
    setPdfReport(null);
    setPdfParsedFile(null);
    setIsExtractingPdf(false);
    setTargetAccountId('');
    setSaveAsTemplate(false);
    setNewTemplateName('');
    setIsImporting(false);
    setImportResult(null);
    setResultDialogOpen(false);
    dispatchPdfAcknowledgement({ type: 'FILE_CHANGED', fileKey: null });
    dispatchPdfAcknowledgement({ type: 'TEMPLATE_CHANGED', templateId: null });
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setTemplates([]);
    clearTransientImportState();
    const loadTemplates = async () => {
      if (!workspaceId) return;
      try {
        const tpl = await apiGetImportTemplates(workspaceId);
        if (!cancelled) setTemplates(tpl);
      } catch (error) {
        if (!cancelled) console.error(error);
      }
    };
    void loadTemplates();
    return () => { cancelled = true; };
  }, [workspaceId, clearTransientImportState]);

  React.useEffect(() => {
    if (fileType !== 'PDF' || pdfTemplates.length > 0) return;
    apiGetPdfTemplates()
      .then(setPdfTemplates)
      .catch(() => {
        toast({
          variant: 'destructive',
          title: 'PDF templates unavailable',
          description: 'The supported PDF template list could not be loaded.',
        });
      });
  }, [fileType, pdfTemplates.length, toast]);

  React.useEffect(() => {
    if (selectedTemplateId === 'manual') return;
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

  const resetFileState = () => clearTransientImportState();

  const isCurrentEpoch = (epoch: number) => importEpochRef.current === epoch;

  const applyExactSavedMapping = async (
    headers: string[],
    sourceType: ImportTemplate['sourceType'],
    epoch: number
  ) => {
    if (!workspaceId || headers.length === 0) return;
    let match: ImportTemplate | null = null;
    try {
      match = await apiFindMatchingTemplate(workspaceId, headers, sourceType);
    } catch (error) {
      if (isCurrentEpoch(epoch)) console.error(error);
    }
    if (!isCurrentEpoch(epoch)) return;
    if (!match) {
      setSelectedTemplateId('manual');
      setMapping({ dateField: '', descriptionField: '' });
      return;
    }
    setTemplates((current) => current.some((template) => template.id === match.id)
      ? current
      : [...current, match]);
    setSelectedTemplateId(match.id);
    setMapping(match.mapping);
    if (match.defaultAccountId) setTargetAccountId(match.defaultAccountId);
  };

  const handleSavedMappingChanged = (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (templateId === 'manual') {
      setMapping({ dateField: '', descriptionField: '' });
      setTargetAccountId('');
    }
  };

  const handleFileSelected = async (nextFile: File | null) => {
    if (!nextFile) {
      resetFileState();
      return;
    }

    clearTransientImportState();
    const epoch = importEpochRef.current;
    const fileKey = `${nextFile.name}:${nextFile.size}:${nextFile.lastModified}`;
    dispatchPdfAcknowledgement({ type: 'FILE_CHANGED', fileKey });

    const detectedType = detectImportFileType(nextFile.name);
    if (detectedType === 'CSV') {
      setFile(nextFile);
      setFileType('CSV');
      try {
        await parseCsvPreview(nextFile, epoch);
      } catch (error) {
        if (!isCurrentEpoch(epoch)) return;
        toast({
          variant: 'destructive',
          title: 'CSV parsing failed',
          description: error instanceof Error ? error.message : 'The CSV file could not be read.',
        });
      }
      return;
    }

    if (detectedType === 'XLSX') {
      setFile(nextFile);
      setFileType('XLSX');
      setCsvEncoding(null);
      try {
        await parseXlsxPreview(nextFile, epoch);
      } catch (error) {
        if (!isCurrentEpoch(epoch)) return;
        toast({
          variant: 'destructive',
          title: 'XLSX parsing failed',
          description: error instanceof Error ? error.message : 'The XLSX file could not be read.',
        });
      }
      return;
    }

    if (detectedType === 'PDF') {
      setFile(nextFile);
      setFileType('PDF');
      setCsvEncoding(null);
      setSelectedPdfTemplateId('');
      setSaveAsTemplate(false);
      setNewTemplateName('');
      dispatchPdfAcknowledgement({ type: 'TEMPLATE_CHANGED', templateId: null });
      setIsDetectingPdf(true);
      try {
        const detection = await apiDetectPdfStatement(nextFile);
        if (!isCurrentEpoch(epoch)) return;
        setPdfDetection(detection);
        const matches = detection.candidates.filter((candidate) => candidate.matched);
        if (detection.decision === 'single_match' && matches.length === 1) {
          const parserId = matches[0].parserId;
          setSelectedPdfTemplateId(parserId);
          dispatchPdfAcknowledgement({ type: 'TEMPLATE_CHANGED', templateId: parserId });
          await extractPdf(nextFile, parserId, epoch);
        }
      } catch (error) {
        if (!isCurrentEpoch(epoch)) return;
        setShowManualPdfParsers(true);
        toast({
          variant: 'destructive',
          title: 'PDF inspection failed',
          description: error instanceof PdfExtractionApiError
            ? getPdfExtractionErrorMessage(error.code)
            : 'The PDF could not be inspected.',
        });
      } finally {
        if (isCurrentEpoch(epoch)) setIsDetectingPdf(false);
      }
      return;
    }

    resetFileState();
    toast({
      variant: 'destructive',
      title: 'Unsupported file type',
      description: 'Please upload a CSV, XLSX, or PDF file.',
    });
  };

  const handlePdfTemplateChanged = (templateId: string) => {
    setSelectedPdfTemplateId(templateId);
    setPdfReport(null);
    setPdfParsedFile(null);
    setPreviewRows([]);
    setMapping(null);
    dispatchPdfAcknowledgement({ type: 'TEMPLATE_CHANGED', templateId });
  };

  const extractPdf = async (inputFile: File, parserId: string, epoch: number) => {
    setIsExtractingPdf(true);
    setPdfReport(null);
    setPdfParsedFile(null);
    setPreviewRows([]);
    setMapping(null);
    dispatchPdfAcknowledgement({ type: 'ACKNOWLEDGE', value: false });
    try {
      const report = await apiExtractPdfStatement(inputFile, parserId);
      const adapted = adaptPdfExtraction(report);
      if (!isCurrentEpoch(epoch)) return;
      setPdfReport(report);
      setPdfParsedFile(adapted.parsedFile);
      setMapping(adapted.mapping);
      setPreviewRows(adapted.previewRows);
    } catch (error) {
      if (!isCurrentEpoch(epoch)) return;
      const description = error instanceof PdfExtractionApiError
        ? getPdfExtractionErrorMessage(error.code)
        : error instanceof PdfImportAdapterError
          ? error.message
          : 'The PDF could not be extracted.';
      toast({ variant: 'destructive', title: 'PDF extraction failed', description });
    } finally {
      if (isCurrentEpoch(epoch)) setIsExtractingPdf(false);
    }
  };

  const handlePdfExtract = async () => {
    if (!file || fileType !== 'PDF' || !selectedPdfTemplateId) {
      toast({
        variant: 'destructive',
        title: 'PDF parser required',
        description: 'Select the matching statement format before extracting.',
      });
      return;
    }
    await extractPdf(file, selectedPdfTemplateId, importEpochRef.current);
  };

  const parseCsvPreview = async (inputFile: File, epoch: number) => {
    const parsed = parseCsvBytes(await inputFile.arrayBuffer());
    if (!isCurrentEpoch(epoch)) return;
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
    setMapping({ dateField: '', descriptionField: '' });
    await applyExactSavedMapping(parsed.headers, 'CSV', epoch);
  };

  const parseXlsxPreview = async (inputFile: File, epoch: number) => {
    const data = await inputFile.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
    const parsed = collectXlsxRows(json);
    const headers = json[0]?.map((header) => String(header ?? '').trim()).filter(Boolean) ?? [];
    if (!isCurrentEpoch(epoch)) return;

    setHeaderColumns(headers);
    setPreviewRows(parsed.rows.slice(0, 10).map((row) => row.values));
    setMapping({ dateField: '', descriptionField: '' });
    if (parsed.globalErrors.length > 0) {
      toast({
        variant: 'destructive',
        title: 'XLSX parsing failed',
        description: parsed.globalErrors[0],
      });
    }
    await applyExactSavedMapping(headers, 'XLSX', epoch);
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
    if (type === 'XLSX') return parseFullXlsx(inputFile);
    if (!pdfParsedFile) throw new Error('Extract and preview the PDF before importing.');
    return pdfParsedFile;
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

    if (fileType === 'PDF' && (!pdfReport || !pdfReconciliationGate?.canContinue)) {
      toast({
        variant: 'destructive',
        title: 'PDF import not ready',
        description: pdfReconciliationGate?.blocked
          ? pdfReconciliationGate.reason
          : 'Extract the PDF and acknowledge any reconciliation warning before importing.',
      });
      return;
    }

    if (fileType !== 'PDF' && saveAsTemplate && !newTemplateName.trim()) {
      toast({
        variant: 'destructive',
        title: 'Template name required',
        description: 'Enter a name to save this template.',
      });
      return;
    }

    const epoch = importEpochRef.current;
    setIsImporting(true);
    try {
      const parsedFile = await parseFullFile(file, fileType);
      if (!isCurrentEpoch(epoch)) return;
      if (parsedFile.globalErrors.length > 0) {
        throw new Error(parsedFile.globalErrors.join(' '));
      }

      const rules = await apiGetRules(workspaceId);
      if (!isCurrentEpoch(epoch)) return;
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
          template: fileType === 'PDF'
            ? (
              pdfTemplates.find((template) => template.id === selectedPdfTemplateId)?.name ||
              pdfDetection?.candidates.find((candidate) => candidate.parserId === selectedPdfTemplateId)?.displayName ||
              '(unknown)'
            )
            : selectedTemplateId === 'manual'
              ? '(ad-hoc)'
              : (templates.find((template) => template.id === selectedTemplateId)?.name || '(unknown)'),
          transactionCount: prepared.transactions.length,
        },
        prepared.transactions
      );
      if (!isCurrentEpoch(epoch)) return;

      await reloadTransactions();
      if (!isCurrentEpoch(epoch)) return;
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

      if (fileType !== 'PDF' && saveAsTemplate && newTemplateName.trim()) {
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
      if (!isCurrentEpoch(epoch)) return;
      console.error(error);
      toast({
        variant: 'destructive',
        title: 'Import failed',
        description: error instanceof Error
          ? error.message
          : 'Something went wrong while importing this file.',
      });
    } finally {
      if (isCurrentEpoch(epoch)) setIsImporting(false);
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
          <CardDescription>Choose a CSV, XLS, XLSX, or selectable-text PDF file to begin.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <FileUploader file={file} onFileSelected={handleFileSelected} />

          {flowStage === 'tabular' && (
            <div className="space-y-2">
              <Label htmlFor="saved-mapping">Saved mapping</Label>
              <Select value={selectedTemplateId} onValueChange={handleSavedMappingChanged}>
                <SelectTrigger id="saved-mapping">
                  <SelectValue placeholder="Choose a saved mapping" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Map columns manually</SelectItem>
                  {templates.filter((template) => template.sourceType === fileType).map((tpl) => (
                    <SelectItem key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                An exact saved header match is selected automatically. You can still choose another mapping.
              </p>
            </div>
          )}
          {fileType === 'CSV' && csvEncoding && (
            <p className="text-xs text-muted-foreground">CSV encoding: {csvEncoding}</p>
          )}

          {flowStage === 'pdf' && file && (
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle>PDF statement</CardTitle>
                <CardDescription>
                  FlowLedger checks this selectable-text PDF against its supported statement formats.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {isDetectingPdf && (
                  <p className="text-sm text-muted-foreground">Inspecting PDF…</p>
                )}

                {pdfDetection?.decision === 'unusable_pdf' && (
                  <Alert variant="destructive">
                    <AlertTitle>Selectable text required</AlertTitle>
                    <AlertDescription>
                      This PDF appears scanned or image-only. OCR is not supported in this version.
                    </AlertDescription>
                  </Alert>
                )}

                {pdfDetection?.decision === 'single_match' && matchedPdfCandidates[0] && (
                  <Alert>
                    <AlertTitle>Statement format detected</AlertTitle>
                    <AlertDescription>{matchedPdfCandidates[0].displayName}</AlertDescription>
                  </Alert>
                )}

                {pdfDetection?.decision === 'multiple_matches' && (
                  <Alert>
                    <AlertTitle>More than one statement format matches</AlertTitle>
                    <AlertDescription>Choose the correct PDF parser from the matching formats.</AlertDescription>
                  </Alert>
                )}

                {pdfDetection?.decision === 'no_match' && (
                  <Alert>
                    <AlertTitle>Statement format not recognized</AlertTitle>
                    <AlertDescription className="space-y-3">
                      <p>FlowLedger could not recognize this PDF statement automatically.</p>
                      {!showManualPdfParsers && (
                        <Button type="button" variant="outline" onClick={() => setShowManualPdfParsers(true)}>
                          Choose parser manually
                        </Button>
                      )}
                    </AlertDescription>
                  </Alert>
                )}

                {(pdfDetection?.decision === 'multiple_matches' || showManualPdfParsers) && (
                  <div className="space-y-2">
                    <Label>PDF parser</Label>
                    <Select value={selectedPdfTemplateId} onValueChange={handlePdfTemplateChanged}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select the statement format" />
                      </SelectTrigger>
                      <SelectContent>
                        {(pdfDetection?.decision === 'multiple_matches'
                          ? matchedPdfCandidates.map((candidate) => ({ id: candidate.parserId, name: candidate.displayName }))
                          : pdfTemplates
                        ).map((parser) => (
                          <SelectItem key={parser.id} value={parser.id}>
                            {parser.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {showManualPdfParsers && (
                      <p className="text-xs text-muted-foreground">
                        Manual selection still verifies that the PDF matches the chosen parser.
                      </p>
                    )}
                  </div>
                )}

                {pdfDetection?.decision !== 'unusable_pdf' && !isDetectingPdf && (
                  <div className="space-y-2">
                    <Label>Target account</Label>
                    <Select value={targetAccountId} onValueChange={setTargetAccountId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select account" />
                      </SelectTrigger>
                      <SelectContent>
                        {accountOptions.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {isExtractingPdf && <p className="text-sm text-muted-foreground">Extracting transactions…</p>}

                {!isDetectingPdf && !isExtractingPdf && selectedPdfTemplateId && !pdfReport && (
                  <Button type="button" variant="outline" onClick={handlePdfExtract}>
                    Extract and preview
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {pdfReport && pdfReconciliationGate && (
            <Alert variant={pdfReconciliationGate.blocked ? 'destructive' : 'default'}>
              <AlertTitle>Reconciliation: {pdfReconciliationGate.displayStatus}</AlertTitle>
              <AlertDescription>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                  <span><strong>{pdfReport.transactionTable.rowCount}</strong> transactions</span>
                  <span>Opening: <strong>{formatEur(pdfReport.reconciliation.openingBalance)}</strong></span>
                  <span>Closing: <strong>{formatEur(pdfReport.reconciliation.statementClosingBalance)}</strong></span>
                  <span>Difference: <strong>{formatEur(pdfReport.reconciliation.difference)}</strong></span>
                </div>
                <p className="mt-2">{pdfReconciliationGate.reason}</p>
                {pdfReconciliationGate.requiresAcknowledgement && (
                  <div className="mt-3 flex items-center gap-2">
                    <Checkbox
                      id="pdf-reconciliation-acknowledgement"
                      checked={pdfAcknowledgement.acknowledged}
                      onCheckedChange={(checked) => dispatchPdfAcknowledgement({
                        type: 'ACKNOWLEDGE',
                        value: Boolean(checked),
                      })}
                    />
                    <Label htmlFor="pdf-reconciliation-acknowledgement">
                      Import despite reconciliation warning
                    </Label>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

          {fileType === 'PDF' && previewRows.length > 0 && (
            <Card className="border-muted">
              <CardHeader>
                <CardTitle>Preview</CardTitle>
                <CardDescription>First 10 extracted transactions.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {PDF_PREVIEW_COLUMNS.map((column) => <TableHead key={column}>{column}</TableHead>)}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewRows.map((row, rowIndex) => (
                        <TableRow key={rowIndex}>
                          {PDF_PREVIEW_COLUMNS.map((column) => (
                            <TableCell key={`${rowIndex}-${column}`}>
                              {row[column] !== undefined && row[column] !== null ? String(row[column]) : ''}
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

          {headerColumns.length > 0 && fileType !== 'PDF' && (
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
          <Button
            className="w-full"
            onClick={handleImport}
            disabled={
              isImporting ||
              isDetectingPdf ||
              isExtractingPdf ||
              !file ||
              !fileType ||
              !mapping ||
              !targetAccountId ||
              (fileType === 'PDF' && (!pdfReport || !pdfReconciliationGate?.canContinue))
            }
          >
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
