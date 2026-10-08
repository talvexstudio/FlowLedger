import assert from 'node:assert/strict';
import test from 'node:test';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import {
  buildImportSessionSaveRequest,
  buildImportTemplateSaveRequest,
} from './api';
import {
  collectCsvParseResult,
  collectXlsxRows,
  getEffectiveImportMapping,
  isTransactionSufficientlyClassified,
  parseCsvBytes,
  parseImportAmount,
  prepareImportTransactions,
} from './import-processing';
import {
  commitImport,
  ImportCommitError,
  type ImportCommitDependencies,
} from './services/imports';
import {
  findDuplicateTransactions,
  getDuplicateApprovalBlockReason,
} from './utils/duplicate-utils';
import type {
  Category,
  ClassificationRule,
  ImportSession,
  ImportTemplate,
  Subcategory,
  Transaction,
} from './types';

const workspaceId = 'ws-import-test';
const accountId = 'acc-target';

const categories: (Category & { subcategories: Subcategory[] })[] = [
  {
    id: 'cat-expense',
    workspaceId,
    name: 'Food',
    type: 'expense',
    order: 1,
    isSystem: true,
    subcategories: [
      {
        id: 'sub-coffee',
        workspaceId,
        categoryId: 'cat-expense',
        name: 'Coffee',
        order: 1,
        isSystem: true,
        flowType: 'Expense',
      },
    ],
  },
  {
    id: 'cat-income',
    workspaceId,
    name: 'Income',
    type: 'income',
    order: 2,
    isSystem: true,
    subcategories: [
      {
        id: 'sub-salary',
        workspaceId,
        categoryId: 'cat-income',
        name: 'Salary',
        order: 1,
        isSystem: true,
        flowType: 'Income',
      },
    ],
  },
];

const rules: ClassificationRule[] = [
  {
    id: 'rule-coffee',
    workspaceId,
    match: { descriptionContains: 'COFFEE' },
    action: { categoryId: 'cat-expense', subcategoryId: 'sub-coffee', type: 'Expense' },
    createdAt: new Date(),
  },
  {
    id: 'rule-salary',
    workspaceId,
    match: { descriptionContains: 'SALARY' },
    action: { categoryId: 'cat-income', subcategoryId: 'sub-salary', type: 'Income' },
    createdAt: new Date(),
  },
  {
    id: 'rule-duplicate',
    workspaceId,
    match: { descriptionContains: 'KNOWN DUPLICATE' },
    action: { categoryId: 'cat-expense', subcategoryId: 'sub-coffee', type: 'Expense' },
    createdAt: new Date(),
  },
];

const mapping: ImportTemplate['mapping'] = {
  dateField: 'Date',
  descriptionField: 'Description',
  amountField: 'Amount',
  dateFormat: 'dd/MM/yyyy',
  amountOptions: { decimalSeparator: '.', thousandsSeparator: ',' },
};

const existingDuplicate: Transaction = {
  id: 'existing-duplicate',
  workspaceId,
  accountId,
  date: new Date('2026-10-03T00:00:00.000Z'),
  description: 'KNOWN DUPLICATE',
  rawDescription: 'KNOWN DUPLICATE',
  amountOriginal: -50,
  currencyOriginal: 'EUR',
  amountBase: -50,
  type: 'Expense',
  categoryId: 'cat-expense',
  subcategoryId: 'sub-coffee',
  needsReview: false,
  isInternalTransfer: false,
  isPotentialDuplicate: false,
  isInconsistent: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

test('new imports use generated stable-token fallback for recurring merchant variants', () => {
  const generatedRule: ClassificationRule = {
    id: 'rule-pingo',
    workspaceId,
    match: {
      descriptionContains: 'COMPRA 8004 PINGO DOCE AROUCA AROUC CONTACTLESS',
      accountId,
    },
    action: { type: 'Expense', categoryId: 'cat-expense', subcategoryId: 'sub-coffee' },
    createdFromTransactionId: 'tx-earlier',
    createdAt: new Date(),
  };
  const result = prepareImportTransactions(
    [{
      rowNumber: 2,
      values: {
        Date: '03/10/2026',
        Description: 'COMPRA 0822 PINGO DOCE AROUCA AROUC CONTACTLESS',
        Amount: '-12.50',
      },
    }],
    mapping,
    'CSV',
    { workspaceId, accountId },
    [generatedRule],
    categories
  );
  assert.equal(result.transactions[0].categoryId, 'cat-expense');
  assert.equal(result.transactions[0].subcategoryId, 'sub-coffee');
  assert.equal(result.transactions[0].needsReview, false);
});

test('plain import applies InternalTransfer rule semantics but never creates or approves a counterpart', () => {
  const transferRule: ClassificationRule = {
    id: 'rule-atm-transfer',
    workspaceId,
    match: { descriptionContains: 'LEV', matchMode: 'starts_with', accountId },
    action: {
      type: 'InternalTransfer',
      internalDirection: 'Out',
      destinationAccountId: 'acc-cash',
    },
    createdFromTransactionId: 'tx-atm',
    createdAt: new Date(),
  };
  const result = prepareImportTransactions(
    [{ rowNumber: 2, values: { Date: '03/10/2026', Description: 'LEV 1234 ATM', Amount: '-20' } }],
    mapping,
    'CSV',
    { workspaceId, accountId },
    [transferRule],
    categories
  );
  const imported = result.transactions[0];
  assert.equal(imported.type, 'InternalTransfer');
  assert.equal(imported.internalDirection, 'Out');
  assert.equal(imported.destinationAccountId, 'acc-cash');
  assert.equal(imported.linkedTransactionId, undefined);
  assert.equal(imported.needsReview, true);

  const nonPrefix = prepareImportTransactions(
    [{ rowNumber: 3, values: { Date: '03/10/2026', Description: 'PAGAMENTO LEV 1234 ATM', Amount: '-20' } }],
    mapping,
    'CSV',
    { workspaceId, accountId },
    [transferRule],
    categories
  ).transactions[0];
  assert.notEqual(nonPrefix.type, 'InternalTransfer');
  assert.equal(nonPrefix.destinationAccountId, undefined);
});

const makeMemoryDependencies = (
  existing: Transaction[] = [],
  failOnSaveNumber?: number
) => {
  const sessions = new Map<string, ImportSession>();
  let transactions = [...existing];
  let saveCount = 0;

  const dependencies: ImportCommitDependencies = {
    saveSession: async (targetWorkspaceId, data) => {
      const session = { ...data, workspaceId: targetWorkspaceId, id: 'import-test-session' };
      sessions.set(session.id, session);
      return session;
    },
    deleteSession: async (_targetWorkspaceId, importId) => {
      sessions.delete(importId);
    },
    getExistingTransactions: async () => [...existing],
    getAccounts: async () => [],
    saveTransaction: async (targetWorkspaceId, data) => {
      saveCount += 1;
      if (saveCount === failOnSaveNumber) throw new Error('Injected transaction write failure');
      const saved = {
        ...data,
        id: `imported-${saveCount}`,
        workspaceId: targetWorkspaceId,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Transaction;
      transactions.push(saved);
      return saved;
    },
    deleteTransactionsByImport: async (_targetWorkspaceId, importId) => {
      transactions = transactions.filter((transaction) => transaction.importId !== importId);
    },
  };

  return {
    dependencies,
    getSessions: () => [...sessions.values()],
    getTransactions: () => [...transactions],
  };
};

test('CSV MVP fixture validates rows, applies rules, and keeps duplicate and unknown rows in review', async () => {
  const csv = [
    'Date,Description,Amount',
    '01/10/2026,COFFEE SHOP,-12.50',
    '02/10/2026,SALARY PAYMENT,2000',
    '03/10/2026,MYSTERY MERCHANT,-20',
    '03/10/2026,KNOWN DUPLICATE,-50',
    '99/10/2026,BAD DATE,-10',
    '03/10/2026,,-10',
    '03/10/2026,BAD AMOUNT,not-a-number',
  ].join('\n');
  const parsed = collectCsvParseResult(Papa.parse<Record<string, unknown>>(csv, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  }));
  assert.deepEqual(parsed.globalErrors, []);
  assert.equal(parsed.rows.length, 7);

  const prepared = prepareImportTransactions(
    parsed.rows,
    mapping,
    'CSV',
    { workspaceId, accountId },
    rules,
    categories
  );
  assert.equal(prepared.transactions.length, 4);
  assert.equal(prepared.rejectedRows.length, 3);
  assert.deepEqual(prepared.rejectedRows.map((row) => row.rowNumber), [6, 7, 8]);
  assert.match(prepared.rejectedRows[0].reason, /Date/);
  assert.match(prepared.rejectedRows[1].reason, /Description/);
  assert.match(prepared.rejectedRows[2].reason, /Amount/);

  const memory = makeMemoryDependencies([existingDuplicate]);
  const committed = await commitImport(
    workspaceId,
    {
      workspaceId,
      accountId,
      createdAt: new Date(),
      fileName: 'mvp-import.csv',
      sourceType: 'CSV',
      template: '(ad-hoc)',
      transactionCount: 0,
    },
    prepared.transactions,
    memory.dependencies
  );

  assert.equal(committed.session.transactionCount, 4);
  assert.equal(committed.transactions.length, 4);
  assert.ok(committed.transactions.every((transaction) => transaction.accountId === accountId));
  assert.deepEqual(committed.transactions.map((transaction) => transaction.amountBase), [-12.5, 2000, -20, -50]);

  const coffee = committed.transactions.find((transaction) => transaction.description === 'COFFEE SHOP');
  const salary = committed.transactions.find((transaction) => transaction.description === 'SALARY PAYMENT');
  const unknown = committed.transactions.find((transaction) => transaction.description === 'MYSTERY MERCHANT');
  const duplicate = committed.transactions.find((transaction) => transaction.description === 'KNOWN DUPLICATE');
  assert.equal(coffee?.needsReview, false);
  assert.equal(coffee?.subcategoryId, 'sub-coffee');
  assert.equal(salary?.needsReview, false);
  assert.equal(salary?.subcategoryId, 'sub-salary');
  assert.equal(unknown?.needsReview, true);
  assert.equal(duplicate?.isPotentialDuplicate, true);
  assert.equal(duplicate?.needsReview, true);
});

test('CSV structural parser errors are retained as rejected rows', () => {
  const parsed = collectCsvParseResult(Papa.parse<Record<string, unknown>>(
    'Date,Description,Amount\n03/10/2026,EXTRA FIELD,-10,unexpected',
    { header: true, dynamicTyping: true }
  ));
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.rejectedRows.length, 1);
  assert.equal(parsed.rejectedRows[0].rowNumber, 2);
  assert.match(parsed.rejectedRows[0].reason, /CSV parse error/);
});

test('single amount preserves sign and debit/credit mapping derives movement sign', () => {
  assert.deepEqual(
    parseImportAmount('-1.234,56', { decimalSeparator: ',', thousandsSeparator: '.' }),
    { ok: true, value: -1234.56 }
  );
  assert.deepEqual(
    parseImportAmount('12,34.56', { decimalSeparator: '.', thousandsSeparator: ',' }),
    { ok: false, reason: 'Amount is malformed.' }
  );

  const debitCreditMapping: ImportTemplate['mapping'] = {
    dateField: 'Date',
    descriptionField: 'Description',
    debitField: 'Debit',
    creditField: 'Credit',
    dateFormat: 'dd/MM/yyyy',
  };
  const debit = prepareImportTransactions(
    [{ rowNumber: 2, values: { Date: '03/10/2026', Description: 'Debit', Debit: -25, Credit: '' } }],
    debitCreditMapping,
    'CSV',
    { workspaceId, accountId },
    [],
    categories
  );
  const credit = prepareImportTransactions(
    [{ rowNumber: 3, values: { Date: '03/10/2026', Description: 'Credit', Debit: '', Credit: 40 } }],
    debitCreditMapping,
    'CSV',
    { workspaceId, accountId },
    [],
    categories
  );
  assert.equal(debit.transactions[0].amountBase, -25);
  assert.equal(credit.transactions[0].amountBase, 40);
});

test('real Portuguese CSV follows the page defaults, encoding, date, and amount path', () => {
  const csv = [
    'Data Valor;Descrição;Valor;Saldo',
    '03/09/2026;PAG. 919836025 - VODAFONE;-5,90;498,78',
    '03/09/2026;TRF MB WAY P/ ADOSINDA MARIA R PEREIRA SILVA;-31,40;461,48',
    '16/09/2026;TRF. P/O IGCP Encargos da Divida PAG IGCP;1 097,20;1 122,97',
    '18/13/2026;COMPRA 8004 MERCADONA PORTO CONTACTLESS;-37,61;803,87',
    '18/09/2026;;-3,40;788,67',
    '22/09/2026;Dinner with Family;-78,22;786,32',
    '22/09/2026;VIS PAGAMENTO CARTAO DE CREDITO;#-26,89;759,43',
  ].join('\r\n');
  const parsed = parseCsvBytes(Buffer.from(csv, 'latin1'));

  assert.equal(parsed.encoding, 'Windows-1252');
  assert.deepEqual(parsed.headers, ['Data Valor', 'Descrição', 'Valor', 'Saldo']);
  assert.equal(parsed.rows.length, 7);

  const effectiveMapping = getEffectiveImportMapping({
    dateField: 'Data Valor',
    descriptionField: 'Descrição',
    amountField: 'Valor',
    balanceField: 'Saldo',
    amountOptions: { decimalSeparator: ',', thousandsSeparator: ' ' },
  });
  assert.equal(effectiveMapping.dateFormat, 'dd/MM/yyyy');

  const prepared = prepareImportTransactions(
    parsed.rows,
    effectiveMapping,
    'CSV',
    { workspaceId, accountId },
    [],
    categories
  );

  assert.equal(prepared.transactions.length, 4);
  assert.deepEqual(
    prepared.transactions.map((transaction) => transaction.amountBase),
    [-5.9, -31.4, 1097.2, -78.22]
  );
  assert.deepEqual(
    prepared.transactions.map((transaction) => {
      const date = transaction.date as Date;
      return [date.getFullYear(), date.getMonth() + 1, date.getDate()];
    }),
    [[2026, 9, 3], [2026, 9, 3], [2026, 9, 16], [2026, 9, 22]]
  );
  assert.deepEqual(prepared.rejectedRows.map((row) => row.rowNumber), [5, 6, 8]);
  assert.match(prepared.rejectedRows[0].reason, /Date is missing or invalid/);
  assert.equal(prepared.rejectedRows[1].reason, 'Description is missing.');
  assert.doesNotMatch(prepared.rejectedRows[1].reason, /Date/);
  assert.match(prepared.rejectedRows[2].reason, /Amount is malformed/);
});

test('Portuguese amounts require the deliberately selected space thousands separator', () => {
  const portugueseOptions = { decimalSeparator: ',' as const, thousandsSeparator: ' ' as const };
  assert.deepEqual(parseImportAmount('-5,90', portugueseOptions), { ok: true, value: -5.9 });
  assert.deepEqual(parseImportAmount('-31,40', portugueseOptions), { ok: true, value: -31.4 });
  assert.deepEqual(parseImportAmount('1 097,20', portugueseOptions), { ok: true, value: 1097.2 });
  assert.deepEqual(
    parseImportAmount('1 097,20', { decimalSeparator: ',', thousandsSeparator: '.' }),
    { ok: false, reason: 'Amount is malformed.' }
  );
});

test('human Dinner import is flagged through commit when visible descriptions match', async () => {
  const existingDinner: Transaction = {
    ...existingDuplicate,
    id: 'existing-dinner',
    accountId: 'acc1',
    date: new Date(2026, 8, 22, 12),
    description: 'Dinner with Family',
    rawDescription: 'RESTAURANTE LISBOA',
    amountOriginal: -79.87,
    amountBase: -79.87,
    needsReview: false,
  };
  const importedCandidate: Partial<Transaction> = {
    workspaceId,
    accountId: 'acc1',
    date: new Date(2026, 8, 22),
    description: 'Dinner with Family',
    amountOriginal: -79.87,
    amountBase: -79.87,
    type: 'Expense',
    needsReview: false,
    isPotentialDuplicate: false,
  };
  const memory = makeMemoryDependencies([existingDinner]);

  const committed = await commitImport(
    workspaceId,
    {
      workspaceId,
      accountId: 'acc1',
      createdAt: new Date(),
      fileName: 'human-dinner.csv',
      sourceType: 'CSV',
      template: '(ad-hoc)',
      transactionCount: 1,
    },
    [importedCandidate],
    memory.dependencies
  );

  assert.equal(committed.transactions[0].isPotentialDuplicate, true);
  assert.equal(committed.transactions[0].needsReview, true);
  assert.equal(
    committed.transactions[0].potentialDuplicateMatch?.transactionId,
    'existing-dinner'
  );
  assert.equal(
    committed.transactions[0].potentialDuplicateMatch?.description,
    'Dinner with Family'
  );
});

test('duplicate identity matching is symmetric without amount/date-only false positives', () => {
  const existingDinner: Transaction = {
    ...existingDuplicate,
    id: 'existing-dinner',
    workspaceId,
    accountId: 'acc1',
    date: new Date(2026, 8, 22, 12),
    description: 'Dinner with Family',
    rawDescription: 'RESTAURANTE LISBOA',
    amountOriginal: -79.87,
    amountBase: -79.87,
  };
  const candidate = {
    workspaceId,
    accountId: 'acc1',
    date: new Date(2026, 8, 22),
    description: ' Dinner   with FAMILY ',
    amountBase: -79.87,
  };

  assert.equal(findDuplicateTransactions(candidate, [existingDinner]).length, 1);
  assert.equal(findDuplicateTransactions(
    { ...candidate, description: 'Unrelated merchant' },
    [existingDinner]
  ).length, 0);
  assert.equal(findDuplicateTransactions(
    { ...candidate, accountId: 'acc2' },
    [existingDinner]
  ).length, 0);
  assert.equal(findDuplicateTransactions(
    { ...candidate, amountBase: -79.88 },
    [existingDinner]
  ).length, 0);
  assert.equal(findDuplicateTransactions(
    { ...candidate, description: 'Other label', rawDescription: 'RESTAURANTE LISBOA' },
    [existingDinner]
  ).length, 1);
  assert.equal(findDuplicateTransactions(
    { ...candidate, description: 'RESTAURANTE LISBOA' },
    [existingDinner]
  ).length, 1);
});

test('potential duplicate requires explicit edit acknowledgement before approval', () => {
  const duplicate = { isPotentialDuplicate: true };
  assert.match(getDuplicateApprovalBlockReason(duplicate) ?? '', /open Edit/);
  assert.match(
    getDuplicateApprovalBlockReason(duplicate, { needsReview: false }) ?? '',
    /explicitly keep/
  );
  assert.equal(
    getDuplicateApprovalBlockReason(duplicate, {
      needsReview: false,
      isPotentialDuplicate: false,
    }),
    null
  );
});

test('simple XLSX fixture uses the same validation, classification, and commit path', async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Date', 'Description', 'Amount'],
    ['01/10/2026', 'COFFEE XLSX', -7.25],
  ]), 'Statement');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const reopened = XLSX.read(bytes, { type: 'array', cellDates: true });
  const sheetRows = XLSX.utils.sheet_to_json(reopened.Sheets[reopened.SheetNames[0]], {
    header: 1,
  }) as unknown[][];
  const parsed = collectXlsxRows(sheetRows);
  const prepared = prepareImportTransactions(
    parsed.rows,
    mapping,
    'XLSX',
    { workspaceId, accountId },
    rules,
    categories
  );
  assert.equal(prepared.rejectedRows.length, 0);
  assert.equal(prepared.transactions.length, 1);
  assert.equal(prepared.transactions[0].amountBase, -7.25);
  assert.equal(prepared.transactions[0].needsReview, false);
  assert.equal(prepared.transactions[0].accountId, accountId);

  const memory = makeMemoryDependencies();
  const committed = await commitImport(
    workspaceId,
    {
      workspaceId,
      accountId,
      createdAt: new Date(),
      fileName: 'mvp-import.xlsx',
      sourceType: 'XLSX',
      template: 'XLSX test template',
      transactionCount: 0,
    },
    prepared.transactions,
    memory.dependencies
  );
  assert.equal(committed.session.sourceType, 'XLSX');
  assert.equal(committed.session.transactionCount, 1);
  assert.equal(committed.transactions[0].amountBase, -7.25);
});

test('failed server commit rolls back created transactions and the import session', async () => {
  const memory = makeMemoryDependencies([], 2);
  const candidates: Partial<Transaction>[] = [
    {
      accountId,
      date: new Date('2026-10-01'),
      description: 'First',
      rawDescription: 'First',
      amountBase: -10,
      type: 'Expense',
      needsReview: true,
    },
    {
      accountId,
      date: new Date('2026-10-02'),
      description: 'Second',
      rawDescription: 'Second',
      amountBase: -20,
      type: 'Expense',
      needsReview: true,
    },
  ];

  await assert.rejects(
    commitImport(
      workspaceId,
      {
        workspaceId,
        accountId,
        createdAt: new Date(),
        fileName: 'rollback.csv',
        sourceType: 'CSV',
        template: '(ad-hoc)',
        transactionCount: 0,
      },
      candidates,
      memory.dependencies
    ),
    (error: unknown) => {
      assert.ok(error instanceof ImportCommitError);
      assert.equal(error.rollbackComplete, true);
      assert.match(error.message, /rolled back/);
      return true;
    }
  );
  assert.deepEqual(memory.getSessions(), []);
  assert.deepEqual(memory.getTransactions(), []);
});

test('approval classification guard requires category and required subcategory', () => {
  assert.equal(
    isTransactionSufficientlyClassified({ type: 'Expense' }, categories),
    false
  );
  assert.equal(
    isTransactionSufficientlyClassified({ type: 'Expense', categoryId: 'cat-expense' }, categories),
    false
  );
  assert.equal(
    isTransactionSufficientlyClassified({
      type: 'Expense',
      categoryId: 'cat-expense',
      subcategoryId: 'sub-coffee',
    }, categories),
    true
  );
  assert.equal(
    isTransactionSufficientlyClassified({
      type: 'Income',
      categoryId: 'cat-expense',
      subcategoryId: 'sub-coffee',
    }, categories),
    false
  );
});

test('import session and reusable template payloads use the authoritative workspace', () => {
  const sessionPayload = buildImportSessionSaveRequest(workspaceId, {
    accountId,
    createdAt: new Date(),
    fileName: 'statement.csv',
    sourceType: 'CSV',
    template: 'Bank template',
    transactionCount: 2,
  });
  const templatePayload = buildImportTemplateSaveRequest(workspaceId, {
    name: 'Bank template',
    sourceType: 'CSV',
    headerSignature: ['Date', 'Description', 'Amount'],
    mapping,
    defaultAccountId: accountId,
  });

  assert.equal(sessionPayload.workspaceId, workspaceId);
  assert.equal(templatePayload.workspaceId, workspaceId);
  assert.equal(templatePayload.defaultAccountId, accountId);
  assert.deepEqual(templatePayload.mapping, mapping);
});
