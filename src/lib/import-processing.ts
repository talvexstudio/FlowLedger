import { parse } from 'date-fns';
import Papa, { type ParseResult } from 'papaparse';
import type { Account, Category, ClassificationRule, ImportTemplate, Subcategory, Transaction } from './types';
import { applyRulesToTransaction } from './utils/rule-utils';
import { isTransactionSufficientlyClassified } from './transaction-review';

export { isTransactionSufficientlyClassified } from './transaction-review';

export type ImportFileType = 'CSV' | 'XLSX' | 'PDF';

export const DEFAULT_IMPORT_DATE_FORMAT = 'dd/MM/yyyy';
export const DEFAULT_DECIMAL_SEPARATOR = '.';
export const DEFAULT_THOUSANDS_SEPARATOR = ',';

export type CsvTextEncoding = 'UTF-8' | 'Windows-1252';

export type ImportSourceRow = {
  rowNumber: number;
  values: Record<string, unknown>;
};

export type ImportRejectedRow = {
  rowNumber: number;
  reason: string;
  sourceValues: Record<string, unknown>;
};

export type ParsedImportFile = {
  rows: ImportSourceRow[];
  rejectedRows: ImportRejectedRow[];
  globalErrors: string[];
};

type ImportCategories = (Category & { subcategories: Subcategory[] })[];

type ImportContext = {
  workspaceId: string;
  accountId: string;
};

type AmountParseResult =
  | { ok: true; value: number }
  | { ok: false; reason: string };

export const getEffectiveImportMapping = (
  mapping: ImportTemplate['mapping']
): ImportTemplate['mapping'] => ({
  ...mapping,
  dateFormat: mapping.dateFormat ?? DEFAULT_IMPORT_DATE_FORMAT,
  amountOptions: {
    decimalSeparator:
      mapping.amountOptions?.decimalSeparator ?? DEFAULT_DECIMAL_SEPARATOR,
    thousandsSeparator:
      mapping.amountOptions?.thousandsSeparator ?? DEFAULT_THOUSANDS_SEPARATOR,
  },
});

export const decodeCsvBytes = (
  input: ArrayBuffer | Uint8Array
): { text: string; encoding: CsvTextEncoding } => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      encoding: 'UTF-8',
    };
  } catch {
    return {
      text: new TextDecoder('windows-1252').decode(bytes),
      encoding: 'Windows-1252',
    };
  }
};

const isBlank = (value: unknown) =>
  value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

const relevantSourceValues = (
  row: Record<string, unknown>,
  mapping: ImportTemplate['mapping']
) => {
  const values: Record<string, unknown> = {
    date: row[mapping.dateField],
    description: row[mapping.descriptionField],
  };

  if (mapping.amountField) values.amount = row[mapping.amountField];
  if (mapping.debitField) values.debit = row[mapping.debitField];
  if (mapping.creditField) values.credit = row[mapping.creditField];

  return values;
};

export const collectCsvParseResult = (
  results: ParseResult<Record<string, unknown>>
): ParsedImportFile => {
  const rowErrors = new Map<number, string[]>();
  const globalErrors: string[] = [];

  for (const error of results.errors) {
    if (typeof error.row === 'number') {
      const messages = rowErrors.get(error.row) ?? [];
      messages.push(error.message);
      rowErrors.set(error.row, messages);
    } else {
      globalErrors.push(error.message);
    }
  }

  const rows: ImportSourceRow[] = [];
  const rejectedRows: ImportRejectedRow[] = [];

  results.data.forEach((values, index) => {
    const rowNumber = index + 2;
    const errors = rowErrors.get(index);
    if (errors?.length) {
      rejectedRows.push({
        rowNumber,
        reason: `CSV parse error: ${errors.join('; ')}`,
        sourceValues: values,
      });
      return;
    }
    rows.push({ rowNumber, values });
  });

  return { rows, rejectedRows, globalErrors };
};

export const parseCsvBytes = (input: ArrayBuffer | Uint8Array) => {
  const decoded = decodeCsvBytes(input);
  const results = Papa.parse<Record<string, unknown>>(decoded.text, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });

  return {
    ...collectCsvParseResult(results),
    headers: results.meta.fields ?? [],
    encoding: decoded.encoding,
  };
};

export const collectXlsxRows = (sheetRows: unknown[][]): ParsedImportFile => {
  if (sheetRows.length === 0) {
    return { rows: [], rejectedRows: [], globalErrors: [] };
  }

  const [headerRow, ...dataRows] = sheetRows;
  const headers = headerRow.map((header) => String(header ?? '').trim());
  if (headers.every((header) => !header)) {
    return { rows: [], rejectedRows: [], globalErrors: ['The first worksheet has no header row.'] };
  }

  const rows = dataRows.flatMap((row, index) => {
    if (!row.some((value) => !isBlank(value))) return [];
    const values: Record<string, unknown> = {};
    headers.forEach((header, columnIndex) => {
      if (header) values[header] = row[columnIndex];
    });
    return [{ rowNumber: index + 2, values }];
  });

  return { rows, rejectedRows: [], globalErrors: [] };
};

export const parseImportDate = (
  value: unknown,
  formatString?: string,
  fileType?: ImportFileType
): Date | null => {
  if (isBlank(value)) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number' && fileType === 'XLSX') {
    const excelEpoch = Date.UTC(1899, 11, 30);
    const parsed = new Date(excelEpoch + value * 86400000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const text = String(value).trim();
  if (formatString) {
    const parsed = parse(text, formatString, new Date());
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const parseImportAmount = (
  value: unknown,
  options?: ImportTemplate['mapping']['amountOptions'],
  allowBlank = false
): AmountParseResult => {
  if (isBlank(value)) {
    return allowBlank ? { ok: true, value: 0 } : { ok: false, reason: 'Amount is missing.' };
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? { ok: true, value }
      : { ok: false, reason: 'Amount is not a finite number.' };
  }

  let raw = String(value).trim();
  let negative = false;
  if (raw.startsWith('(') && raw.endsWith(')')) {
    negative = true;
    raw = raw.slice(1, -1).trim();
  }
  raw = raw.replace(/[€$£]/g, '').trim();
  if (raw.startsWith('-')) {
    negative = true;
    raw = raw.slice(1).trim();
  } else if (raw.startsWith('+')) {
    raw = raw.slice(1).trim();
  }

  const decimalSeparator = options?.decimalSeparator ?? '.';
  const thousandsSeparator = options?.thousandsSeparator ?? ',';
  if (decimalSeparator === thousandsSeparator) {
    return { ok: false, reason: 'Decimal and thousands separators must be different.' };
  }

  if (thousandsSeparator === ' ') {
    raw = raw.replace(/\u00a0/g, ' ');
  } else if (/\s/.test(raw)) {
    return { ok: false, reason: 'Amount is malformed.' };
  }
  if (/[^0-9., ]/.test(raw)) {
    return { ok: false, reason: 'Amount is malformed.' };
  }
  const escapeRegex = (character: string) => character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const decimalPattern = escapeRegex(decimalSeparator);
  const thousandsPattern = escapeRegex(thousandsSeparator);
  const numericPattern = new RegExp(
    `^(?:\\d+|\\d{1,3}(?:${thousandsPattern}\\d{3})+)(?:${decimalPattern}\\d+)?$`
  );
  if (!numericPattern.test(raw)) {
    return { ok: false, reason: 'Amount is malformed.' };
  }
  raw = raw.replace(new RegExp(thousandsPattern, 'g'), '');
  if (decimalSeparator !== '.') raw = raw.replace(decimalSeparator, '.');
  raw = raw.replace(/[^0-9.]/g, '');

  if (!raw || (raw.match(/\./g)?.length ?? 0) > 1) {
    return { ok: false, reason: 'Amount is malformed.' };
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return { ok: false, reason: 'Amount is malformed.' };
  }
  return { ok: true, value: negative ? -parsed : parsed };
};

const applyDefaultTypeFromSubcategory = (
  transaction: Partial<Transaction>,
  categories: ImportCategories
) => {
  if (!transaction.subcategoryId) return transaction;
  const category = categories.find((candidate) =>
    candidate.subcategories.some((subcategory) => subcategory.id === transaction.subcategoryId)
  );
  const subcategory = category?.subcategories.find(
    (candidate) => candidate.id === transaction.subcategoryId
  );
  return subcategory?.flowType
    ? { ...transaction, type: subcategory.flowType }
    : transaction;
};

export const buildTransactionFromImportRow = (
  sourceRow: ImportSourceRow,
  mapping: ImportTemplate['mapping'],
  fileType: ImportFileType,
  context: ImportContext
): { transaction: Partial<Transaction> } | { rejected: ImportRejectedRow } => {
  const { values } = sourceRow;
  const reasons: string[] = [];
  const date = parseImportDate(values[mapping.dateField], mapping.dateFormat, fileType);
  if (!date) reasons.push('Date is missing or invalid.');
  const postingDate = mapping.postingDateField && !isBlank(values[mapping.postingDateField])
    ? parseImportDate(values[mapping.postingDateField], mapping.dateFormat, fileType)
    : null;
  const valueDate = mapping.valueDateField && !isBlank(values[mapping.valueDateField])
    ? parseImportDate(values[mapping.valueDateField], mapping.dateFormat, fileType)
    : null;
  if (mapping.postingDateField && !isBlank(values[mapping.postingDateField]) && !postingDate) {
    reasons.push('Posting date is invalid.');
  }
  if (mapping.valueDateField && !isBlank(values[mapping.valueDateField]) && !valueDate) {
    reasons.push('Value date is invalid.');
  }

  const rawDescriptionValue = values[mapping.descriptionField];
  const description = isBlank(rawDescriptionValue) ? '' : String(rawDescriptionValue).trim();
  if (!description) reasons.push('Description is missing.');

  let amount: number | null = null;
  if (mapping.amountField) {
    const parsed = parseImportAmount(values[mapping.amountField], mapping.amountOptions);
    if (parsed.ok) amount = parsed.value;
    else reasons.push(parsed.reason);
  } else {
    const debitValue = mapping.debitField ? values[mapping.debitField] : undefined;
    const creditValue = mapping.creditField ? values[mapping.creditField] : undefined;
    if (isBlank(debitValue) && isBlank(creditValue)) {
      reasons.push('Debit and credit amounts are both missing.');
    } else {
      const debit = parseImportAmount(debitValue, mapping.amountOptions, true);
      const credit = parseImportAmount(creditValue, mapping.amountOptions, true);
      if (!debit.ok) reasons.push(`Debit: ${debit.reason}`);
      if (!credit.ok) reasons.push(`Credit: ${credit.reason}`);
      if (debit.ok && credit.ok) amount = Math.abs(credit.value) - Math.abs(debit.value);
    }
  }

  if (amount === 0) reasons.push('Amount resolves to zero.');
  let balanceAfter: number | undefined;
  if (mapping.balanceField && !isBlank(values[mapping.balanceField])) {
    const parsedBalance = parseImportAmount(values[mapping.balanceField], mapping.amountOptions);
    if (parsedBalance.ok) balanceAfter = parsedBalance.value;
    else reasons.push(`Balance: ${parsedBalance.reason}`);
  }
  if (reasons.length > 0 || amount === null || !date) {
    return {
      rejected: {
        rowNumber: sourceRow.rowNumber,
        reason: reasons.join(' '),
        sourceValues: relevantSourceValues(values, mapping),
      },
    };
  }

  const rawDescription = mapping.rawDescriptionField
    ? String(values[mapping.rawDescriptionField] ?? '').trim() || description
    : description;
  const type: Transaction['type'] = amount < 0 ? 'Expense' : 'Income';

  return {
    transaction: {
      workspaceId: context.workspaceId,
      accountId: context.accountId,
      date,
      ...(postingDate ? { postingDate } : {}),
      ...(valueDate ? { valueDate } : {}),
      description,
      rawDescription,
      amountOriginal: amount,
      currencyOriginal: 'EUR',
      amountBase: amount,
      balanceAfter,
      type,
      needsReview: true,
      isInternalTransfer: false,
      isPotentialDuplicate: false,
      isInconsistent: false,
    },
  };
};

export const prepareImportTransactions = (
  sourceRows: ImportSourceRow[],
  mapping: ImportTemplate['mapping'],
  fileType: ImportFileType,
  context: ImportContext,
  rules: ClassificationRule[],
  categories: ImportCategories
) => {
  const transactions: Partial<Transaction>[] = [];
  const rejectedRows: ImportRejectedRow[] = [];

  for (const sourceRow of sourceRows) {
    const built = buildTransactionFromImportRow(sourceRow, mapping, fileType, context);
    if ('rejected' in built) {
      rejectedRows.push(built.rejected);
      continue;
    }
    const withRules = applyRulesToTransaction(built.transaction, rules);
    const classified = applyDefaultTypeFromSubcategory(withRules, categories);
    const hasImportSafeType = classified.type === 'Expense' || classified.type === 'Income';
    transactions.push({
      ...classified,
      workspaceId: context.workspaceId,
      accountId: context.accountId,
      needsReview: !hasImportSafeType || !isTransactionSufficientlyClassified(classified, categories),
    });
  }

  return { transactions, rejectedRows };
};
