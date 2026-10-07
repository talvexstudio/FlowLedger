import assert from 'node:assert/strict';
import test from 'node:test';
import { buildImportSessionSaveRequest } from '@/lib/api';
import { prepareImportTransactions } from '@/lib/import-processing';
import { commitImport, type ImportCommitDependencies } from '@/lib/services/imports';
import type { Category, ClassificationRule, ImportSession, Subcategory, Transaction } from '@/lib/types';
import { adaptPdfExtraction, PdfImportAdapterError, PDF_IMPORT_FIELDS } from './adapter';
import { getPdfExtractionErrorMessage } from './errors';
import { evaluatePdfReconciliation, reducePdfAcknowledgement } from './reconciliation';
import type { PdfExtractionReport, PdfExtractionRow } from './types';

const baseRow: PdfExtractionRow = {
  postingDateRaw: '03/08/2026',
  valueDateRaw: '04/08/2026',
  postingDate: '2026-08-03',
  valueDate: '2026-08-04',
  description: 'TEST MERCHANT',
  signedAmountRaw: '-12,50',
  debitRaw: null,
  creditRaw: null,
  balanceRaw: '87,50',
  page: 1,
  source: { bbox: [1, 2, 3, 4], y: 2 },
};

const makeReport = (
  row: PdfExtractionRow = baseRow,
  overrides: Partial<PdfExtractionReport> = {}
): PdfExtractionReport => ({
  reportVersion: 2,
  engineVersion: '1.0',
  template: {
    schemaVersion: 1,
    id: 'cgd-current-account-v1',
    name: 'CGD Current Account',
  },
  source: { filename: 'statement.pdf' },
  document: { pageCount: 1, selectableText: true },
  context: { currency: { value: 'EUR' } },
  transactionTable: {
    amountModel: 'SIGNED_AMOUNT',
    dateModel: 'FULL_DATE',
    primaryDateRole: 'postingDate',
    detectedPages: [{ page: 1, rowCount: 1 }],
    rowCount: 1,
    signedAmountRowCount: 1,
    debitRowCount: 1,
    creditRowCount: 0,
    ambiguousRowCount: 0,
    ambiguousRows: [],
    rows: [row],
  },
  reconciliation: {
    mode: 'FULL_RECONCILIATION',
    openingBalance: 100,
    totalDebits: 12.5,
    totalCredits: 0,
    calculatedClosingBalance: 87.5,
    statementClosingBalance: 87.5,
    difference: 0,
    rowContinuityFailureCount: 0,
    status: 'PASS',
  },
  scopeDiagnostics: {},
  ...overrides,
});

const categories: (Category & { subcategories: Subcategory[] })[] = [{
  id: 'cat-food',
  workspaceId: 'ws-pdf',
  name: 'Food',
  type: 'expense',
  order: 1,
  isSystem: true,
  subcategories: [{
    id: 'sub-dining',
    workspaceId: 'ws-pdf',
    categoryId: 'cat-food',
    name: 'Dining',
    order: 1,
    isSystem: true,
    flowType: 'Expense',
  }],
}];

const rules: ClassificationRule[] = [{
  id: 'rule-test',
  workspaceId: 'ws-pdf',
  match: { descriptionContains: 'TEST MERCHANT' },
  action: { categoryId: 'cat-food', subcategoryId: 'sub-dining', type: 'Expense' },
  createdAt: new Date(),
}];

test('SIGNED_AMOUNT PDF row adapts to the existing amount field', () => {
  const adapted = adaptPdfExtraction(makeReport());
  assert.equal(adapted.mapping.amountField, PDF_IMPORT_FIELDS.amount);
  assert.equal(adapted.parsedFile.rows[0].values[PDF_IMPORT_FIELDS.amount], '-12,50');
  assert.equal(adapted.parsedFile.rows[0].rowNumber, 1);
});

test('DEBIT_CREDIT PDF row preserves separate debit and credit fields', () => {
  const report = makeReport({
    ...baseRow,
    signedAmountRaw: null,
    debitRaw: '12.50',
    creditRaw: null,
  });
  report.transactionTable.amountModel = 'DEBIT_CREDIT';
  const adapted = adaptPdfExtraction(report);
  assert.equal(adapted.mapping.amountField, undefined);
  assert.equal(adapted.mapping.debitField, PDF_IMPORT_FIELDS.debit);
  assert.equal(adapted.mapping.creditField, PDF_IMPORT_FIELDS.credit);
  assert.equal(adapted.parsedFile.rows[0].values[PDF_IMPORT_FIELDS.debit], '12.50');
});

test('postingDate primary selection and secondary valueDate survive preparation', () => {
  const adapted = adaptPdfExtraction(makeReport());
  const prepared = prepareImportTransactions(
    adapted.parsedFile.rows,
    adapted.mapping,
    'PDF',
    { workspaceId: 'ws-pdf', accountId: 'acc-pdf' },
    rules,
    categories
  );
  assert.equal(prepared.rejectedRows.length, 0);
  assert.equal(prepared.transactions[0].date?.getDate(), 3);
  assert.equal(prepared.transactions[0].postingDate?.getDate(), 3);
  assert.equal(prepared.transactions[0].valueDate?.getDate(), 4);
  assert.equal(prepared.transactions[0].amountBase, -12.5);
  assert.equal(prepared.transactions[0].needsReview, false);
});

test('valueDate primary selection keeps postingDate as secondary metadata', () => {
  const report = makeReport();
  report.transactionTable.primaryDateRole = 'valueDate';
  const adapted = adaptPdfExtraction(report);
  const prepared = prepareImportTransactions(
    adapted.parsedFile.rows,
    adapted.mapping,
    'PDF',
    { workspaceId: 'ws-pdf', accountId: 'acc-pdf' },
    [],
    categories
  );
  assert.equal(prepared.transactions[0].date?.getDate(), 4);
  assert.equal(prepared.transactions[0].postingDate?.getDate(), 3);
  assert.equal(prepared.transactions[0].valueDate?.getDate(), 4);
});

test('PDF extraction ambiguity becomes an existing ImportRejectedRow', () => {
  const report = makeReport();
  report.transactionTable.ambiguousRowCount = 1;
  report.transactionTable.ambiguousRows = [{
    page: 2,
    y: 123,
    text: '03/08/2026 incomplete row',
    reasons: ['missing debit/credit'],
  }];
  const rejected = adaptPdfExtraction(report).parsedFile.rejectedRows[0];
  assert.equal(rejected.rowNumber, 2);
  assert.match(rejected.reason, /missing debit\/credit/);
  assert.equal(rejected.sourceValues.page, 2);
});

test('reconciliation PASS continues without acknowledgement', () => {
  const gate = evaluatePdfReconciliation(makeReport().reconciliation, false);
  assert.equal(gate.displayStatus, 'PASS');
  assert.equal(gate.canContinue, true);
  assert.equal(gate.requiresAcknowledgement, false);
});

test('reconciliation warning requires explicit acknowledgement', () => {
  const reconciliation = { ...makeReport().reconciliation, status: 'FAIL' as const, difference: 1 };
  assert.equal(evaluatePdfReconciliation(reconciliation, false).canContinue, false);
  assert.equal(evaluatePdfReconciliation(reconciliation, true).canContinue, true);
});

test('reconciliation acknowledgement resets when file or template changes', () => {
  const acknowledged = { acknowledged: true, fileKey: 'a.pdf:1', templateId: 'template-a' };
  const afterFile = reducePdfAcknowledgement(acknowledged, { type: 'FILE_CHANGED', fileKey: 'b.pdf:2' });
  assert.equal(afterFile.acknowledged, false);
  const afterTemplate = reducePdfAcknowledgement(
    { ...acknowledged },
    { type: 'TEMPLATE_CHANGED', templateId: 'template-b' }
  );
  assert.equal(afterTemplate.acknowledged, false);
});

test('FULL_RECONCILIATION with unavailable result blocks import', () => {
  const reconciliation = { ...makeReport().reconciliation, status: 'UNAVAILABLE' as const };
  const gate = evaluatePdfReconciliation(reconciliation, true);
  assert.equal(gate.blocked, true);
  assert.equal(gate.canContinue, false);
});

test('NONE reconciliation is informational but requires acknowledgement', () => {
  const reconciliation = {
    ...makeReport().reconciliation,
    mode: 'NONE' as const,
    status: 'SKIPPED' as const,
  };
  assert.equal(evaluatePdfReconciliation(reconciliation, false).canContinue, false);
  assert.equal(evaluatePdfReconciliation(reconciliation, true).canContinue, true);
});

test('known non-EUR PDF is blocked by the adapter', () => {
  const report = makeReport();
  report.context.currency = { value: 'USD' };
  assert.throws(
    () => adaptPdfExtraction(report),
    (error: unknown) => error instanceof PdfImportAdapterError && error.code === 'NON_EUR_CURRENCY'
  );
});

test('structured extraction errors map to concise browser-safe messages', () => {
  assert.match(getPdfExtractionErrorMessage('NO_SELECTABLE_TEXT'), /scanned or image-only/);
  assert.equal(
    getPdfExtractionErrorMessage('TEMPLATE_MISMATCH'),
    'This statement does not match the selected PDF template.'
  );
  assert.equal(
    getPdfExtractionErrorMessage('PYTHON_UNAVAILABLE'),
    'The local PDF extraction runtime is unavailable.'
  );
});

test('PDF source type reaches import session and duplicate detection remains active', async () => {
  const adapted = adaptPdfExtraction(makeReport());
  const prepared = prepareImportTransactions(
    adapted.parsedFile.rows,
    adapted.mapping,
    'PDF',
    { workspaceId: 'ws-pdf', accountId: 'acc-pdf' },
    rules,
    categories
  );
  const existing: Transaction = {
    ...prepared.transactions[0],
    id: 'existing',
    workspaceId: 'ws-pdf',
    accountId: 'acc-pdf',
    date: new Date(2026, 7, 3),
    description: 'TEST MERCHANT',
    rawDescription: 'TEST MERCHANT',
    amountOriginal: -12.5,
    currencyOriginal: 'EUR',
    amountBase: -12.5,
    type: 'Expense',
    needsReview: false,
    isInternalTransfer: false,
    isPotentialDuplicate: false,
    isInconsistent: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const dependencies: ImportCommitDependencies = {
    saveSession: async (workspaceId, session) => ({
      ...session,
      workspaceId,
      id: 'pdf-session',
    }),
    deleteSession: async () => undefined,
    getExistingTransactions: async () => [existing],
    getAccounts: async () => [],
    saveTransaction: async (workspaceId, transaction) => ({
      ...transaction,
      id: 'pdf-transaction',
      workspaceId,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Transaction),
    deleteTransactionsByImport: async () => undefined,
  };
  const sessionRequest = buildImportSessionSaveRequest('ws-pdf', {
    accountId: 'acc-pdf',
    createdAt: new Date(),
    fileName: 'statement.pdf',
    sourceType: 'PDF',
    template: 'CGD Current Account',
    transactionCount: 1,
  });
  const committed = await commitImport('ws-pdf', sessionRequest, prepared.transactions, dependencies);
  assert.equal(committed.session.sourceType, 'PDF');
  assert.equal(committed.transactions[0].isPotentialDuplicate, true);
  assert.equal(committed.transactions[0].needsReview, true);
});

test('unclassified PDF transaction retains existing needsReview semantics', () => {
  const adapted = adaptPdfExtraction(makeReport());
  const prepared = prepareImportTransactions(
    adapted.parsedFile.rows,
    adapted.mapping,
    'PDF',
    { workspaceId: 'ws-pdf', accountId: 'acc-pdf' },
    [],
    categories
  );
  assert.equal(prepared.transactions[0].needsReview, true);
});
