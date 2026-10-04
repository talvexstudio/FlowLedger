import type { ImportTemplate } from '@/lib/types';
import type { ImportRejectedRow, ParsedImportFile } from '@/lib/import-processing';
import type { PdfExtractionReport, PdfExtractionRow } from './types';

export const PDF_IMPORT_FIELDS = {
  primaryDate: 'Date',
  postingDate: 'Posting Date',
  valueDate: 'Value Date',
  postingDateRaw: 'Posting Date (source)',
  valueDateRaw: 'Value Date (source)',
  description: 'Description',
  amount: 'Amount',
  debit: 'Debit',
  credit: 'Credit',
  balance: 'Balance',
  page: 'PDF Page',
} as const;

export class PdfImportAdapterError extends Error {
  constructor(
    message: string,
    readonly code: 'NON_EUR_CURRENCY'
  ) {
    super(message);
    this.name = 'PdfImportAdapterError';
  }
}

const rawAmounts = (rows: PdfExtractionRow[]) => rows.flatMap((row) =>
  [row.signedAmountRaw, row.debitRaw, row.creditRaw, row.balanceRaw].filter(
    (value): value is string => Boolean(value)
  )
);

const inferAmountOptions = (
  rows: PdfExtractionRow[]
): NonNullable<ImportTemplate['mapping']['amountOptions']> => {
  const samples = rawAmounts(rows);
  const commaDecimal = samples.some((value) => /,\d{2}(?:[^\d]*)$/.test(value.trim()));
  const decimalSeparator = commaDecimal ? ',' : '.';
  const integerParts = samples.map((value) => value.trim().split(decimalSeparator)[0] ?? '');
  const thousandsSeparator = integerParts.some((value) => /\d\s+\d{3}/.test(value))
    ? ' '
    : integerParts.some((value) => value.includes(decimalSeparator === ',' ? '.' : ','))
      ? (decimalSeparator === ',' ? '.' : ',')
      : (decimalSeparator === ',' ? '.' : ',');
  return { decimalSeparator, thousandsSeparator };
};

const primaryDate = (row: PdfExtractionRow, role: 'postingDate' | 'valueDate') =>
  role === 'postingDate' ? row.postingDate : row.valueDate;

export const getPdfImportMapping = (
  report: PdfExtractionReport
): ImportTemplate['mapping'] => ({
  dateField: PDF_IMPORT_FIELDS.primaryDate,
  postingDateField: PDF_IMPORT_FIELDS.postingDate,
  valueDateField: PDF_IMPORT_FIELDS.valueDate,
  descriptionField: PDF_IMPORT_FIELDS.description,
  amountField: report.transactionTable.amountModel === 'SIGNED_AMOUNT'
    ? PDF_IMPORT_FIELDS.amount
    : undefined,
  debitField: report.transactionTable.amountModel === 'DEBIT_CREDIT'
    ? PDF_IMPORT_FIELDS.debit
    : undefined,
  creditField: report.transactionTable.amountModel === 'DEBIT_CREDIT'
    ? PDF_IMPORT_FIELDS.credit
    : undefined,
  balanceField: PDF_IMPORT_FIELDS.balance,
  dateFormat: 'yyyy-MM-dd',
  amountOptions: inferAmountOptions(report.transactionTable.rows),
});

const toSourceValues = (
  row: PdfExtractionRow,
  report: PdfExtractionReport
): Record<string, unknown> => ({
  [PDF_IMPORT_FIELDS.primaryDate]: primaryDate(row, report.transactionTable.primaryDateRole),
  [PDF_IMPORT_FIELDS.postingDate]: row.postingDate,
  [PDF_IMPORT_FIELDS.valueDate]: row.valueDate,
  [PDF_IMPORT_FIELDS.postingDateRaw]: row.postingDateRaw,
  [PDF_IMPORT_FIELDS.valueDateRaw]: row.valueDateRaw,
  [PDF_IMPORT_FIELDS.description]: row.description,
  [PDF_IMPORT_FIELDS.amount]: row.signedAmountRaw,
  [PDF_IMPORT_FIELDS.debit]: row.debitRaw,
  [PDF_IMPORT_FIELDS.credit]: row.creditRaw,
  [PDF_IMPORT_FIELDS.balance]: row.balanceRaw,
  [PDF_IMPORT_FIELDS.page]: row.page,
});

const extractionRejectedRows = (report: PdfExtractionReport): ImportRejectedRow[] =>
  report.transactionTable.ambiguousRows.map((row, index) => ({
    rowNumber: report.transactionTable.rows.length + index + 1,
    reason: `PDF extraction: ${row.reasons.join('; ') || 'ambiguous row'}.`,
    sourceValues: {
      page: row.page,
      y: row.y,
      text: row.text,
    },
  }));

export type AdaptedPdfImport = {
  parsedFile: ParsedImportFile;
  mapping: ImportTemplate['mapping'];
  previewRows: Record<string, unknown>[];
};

export const adaptPdfExtraction = (report: PdfExtractionReport): AdaptedPdfImport => {
  const currency = report.context.currency?.value?.trim().toUpperCase();
  if (currency && currency !== 'EUR') {
    throw new PdfImportAdapterError(
      `PDF Import V1 supports EUR statements only. This statement uses ${currency}.`,
      'NON_EUR_CURRENCY'
    );
  }

  const rows = report.transactionTable.rows.map((row, index) => ({
    rowNumber: index + 1,
    values: toSourceValues(row, report),
  }));
  const parsedFile: ParsedImportFile = {
    rows,
    rejectedRows: extractionRejectedRows(report),
    globalErrors: [],
  };
  return {
    parsedFile,
    mapping: getPdfImportMapping(report),
    previewRows: rows.slice(0, 10).map((row) => row.values),
  };
};
