// Client-side API wrapper — typed fetch helpers for all server routes.
// Import these in client components instead of services directly.

import type {
  Account,
  Budget,
  BudgetLine,
  Category,
  ClassificationRule,
  ImportSession,
  ImportTemplate,
  Subcategory,
  Transaction,
  TransferCounterpartCandidate,
  TransferResolutionResult,
  Workspace,
} from '@/lib/types';
import type {
  PdfExtractionErrorCode,
  PdfExtractionReport,
  PdfTemplateSummary,
} from '@/lib/pdf-import/types';
import type {
  TransactionBulkDeletePreview,
  TransactionBulkDeleteResult,
} from '@/lib/data-management/transaction-bulk-delete-types';

async function call<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? `Request failed: ${res.status}`);
  return json as T;
}

// ─── Workspaces ────────────────────────────────────────────────────────────
export const apiGetWorkspaces = () =>
  call<Workspace[]>('/api/workspaces');

export const apiSaveWorkspace = (data: Partial<Workspace>) =>
  call<Workspace>('/api/workspaces', { method: 'POST', body: JSON.stringify(data) });

// ─── Accounts ──────────────────────────────────────────────────────────────
export const apiGetAccounts = (workspaceId: string) =>
  call<Account[]>(`/api/accounts?workspaceId=${workspaceId}`);

export const apiSaveAccount = (workspaceId: string, data: Partial<Account>) =>
  call<Account>('/api/accounts', { method: 'POST', body: JSON.stringify({ workspaceId, ...data }) });

export const apiArchiveAccount = (workspaceId: string, id: string) =>
  call<{ ok: true }>('/api/accounts', { method: 'DELETE', body: JSON.stringify({ workspaceId, id, action: 'archive' }) });

export const apiDeleteAccount = (workspaceId: string, id: string) =>
  call<{ ok: true }>('/api/accounts', { method: 'DELETE', body: JSON.stringify({ workspaceId, id }) });

// ─── Transactions ──────────────────────────────────────────────────────────
export const apiGetTransactions = (workspaceId: string) =>
  call<Transaction[]>(`/api/transactions?workspaceId=${workspaceId}`);

export const apiSaveTransaction = (workspaceId: string, data: Partial<Transaction>) =>
  call<Transaction>('/api/transactions', { method: 'POST', body: JSON.stringify({ workspaceId, ...data }) });

export const apiConfirmTransaction = (workspaceId: string, transactionId: string) =>
  call<{ ok: true }>('/api/transactions', { method: 'PATCH', body: JSON.stringify({ action: 'confirm', workspaceId, transactionId }) });

export const apiDeleteTransaction = (workspaceId: string, id: string) =>
  call<{ ok: true }>('/api/transactions', { method: 'DELETE', body: JSON.stringify({ workspaceId, id }) });

export const apiPreviewTransactionBulkDelete = (workspaceId: string, transactionIds: string[]) =>
  call<{ ok: true; preview: TransactionBulkDeletePreview }>(
    '/api/data-management/transactions/delete/preview',
    { method: 'POST', body: JSON.stringify({ workspaceId, transactionIds }) }
  ).then((response) => response.preview);

export const apiBulkDeleteTransactions = (workspaceId: string, transactionIds: string[]) =>
  call<{ ok: true; result: TransactionBulkDeleteResult }>(
    '/api/data-management/transactions/delete',
    { method: 'POST', body: JSON.stringify({ workspaceId, transactionIds, confirmDelete: true }) }
  ).then((response) => response.result);

export const apiDeleteTransactionsByImport = (workspaceId: string, importId: string) =>
  call<{ ok: true }>('/api/transactions', { method: 'DELETE', body: JSON.stringify({ workspaceId, importId }) });

export const apiGetTransferCounterpartCandidates = (
  workspaceId: string,
  transactionId: string
) => call<TransferCounterpartCandidate[]>(
  `/api/transactions?action=transferCandidates&workspaceId=${encodeURIComponent(workspaceId)}&transactionId=${encodeURIComponent(transactionId)}`
);

export const apiLinkExistingTransferPair = (
  workspaceId: string,
  transactionId: string,
  candidateId: string
) => call<TransferResolutionResult>('/api/transactions', {
  method: 'PATCH',
  body: JSON.stringify({ action: 'linkExistingTransfer', workspaceId, transactionId, candidateId }),
});

export const apiCreateCounterpartForExisting = (
  workspaceId: string,
  transactionId: string,
  allowCandidateOverride = false
) => call<TransferResolutionResult>('/api/transactions', {
  method: 'PATCH',
  body: JSON.stringify({
    action: 'createTransferCounterpart',
    workspaceId,
    transactionId,
    allowCandidateOverride,
  }),
});

// ─── Categories ────────────────────────────────────────────────────────────
export const apiGetCategories = (workspaceId: string) =>
  call<(Category & { subcategories: Subcategory[] })[]>(`/api/categories?workspaceId=${workspaceId}`);

export const buildCategorySaveRequest = (
  workspaceId: string,
  data: Category | Omit<Category, 'id'>
) => ({
  entity: 'category' as const,
  workspaceId,
  data,
});

export const buildSubcategorySaveRequest = (
  workspaceId: string,
  categoryId: string,
  data: Subcategory
) => ({
  entity: 'subcategory' as const,
  workspaceId,
  categoryId,
  data: { ...data, categoryId },
});

export const apiSaveCategory = (workspaceId: string, data: Category | Omit<Category, 'id'>) =>
  call<Category>('/api/categories', { method: 'POST', body: JSON.stringify(buildCategorySaveRequest(workspaceId, data)) });

export const apiSaveSubcategory = (workspaceId: string, categoryId: string, data: Subcategory) =>
  call<Subcategory>('/api/categories', { method: 'POST', body: JSON.stringify(buildSubcategorySaveRequest(workspaceId, categoryId, data)) });

// ─── Rules ─────────────────────────────────────────────────────────────────
export const apiGetRules = (workspaceId: string) =>
  call<ClassificationRule[]>(`/api/rules?workspaceId=${workspaceId}`);

export const apiSaveRule = (workspaceId: string, data: ClassificationRule | Omit<ClassificationRule, 'id'>) =>
  call<ClassificationRule>('/api/rules', { method: 'POST', body: JSON.stringify({ ...data, workspaceId }) });

export const apiDeleteRule = (workspaceId: string, id: string) =>
  call<{ ok: true }>('/api/rules', { method: 'DELETE', body: JSON.stringify({ workspaceId, id }) });

// ─── Import Sessions ───────────────────────────────────────────────────────
export const apiGetImportSessions = (workspaceId: string) =>
  call<ImportSession[]>(`/api/imports?workspaceId=${workspaceId}`);

export const buildImportSessionSaveRequest = (
  workspaceId: string,
  data: Omit<ImportSession, 'id' | 'workspaceId'>
) => ({ ...data, workspaceId });

export const apiSaveImportSession = (
  workspaceId: string,
  data: Omit<ImportSession, 'id' | 'workspaceId'>
) =>
  call<ImportSession>('/api/imports', {
    method: 'POST',
    body: JSON.stringify(buildImportSessionSaveRequest(workspaceId, data)),
  });

export const apiCommitImport = (
  workspaceId: string,
  session: Omit<ImportSession, 'id' | 'workspaceId'>,
  transactions: Partial<Transaction>[]
) =>
  call<{ session: ImportSession; transactions: Transaction[] }>('/api/imports', {
    method: 'POST',
    body: JSON.stringify({
      workspaceId,
      session: buildImportSessionSaveRequest(workspaceId, session),
      transactions,
    }),
  });

export const apiDeleteImportSession = (workspaceId: string, id: string) =>
  call<{ ok: true }>('/api/imports', { method: 'DELETE', body: JSON.stringify({ workspaceId, id }) });

// ─── Import Templates ──────────────────────────────────────────────────────
export const apiGetImportTemplates = (workspaceId: string) =>
  call<ImportTemplate[]>(`/api/import-templates?workspaceId=${workspaceId}`);

export const buildImportTemplateSaveRequest = (
  workspaceId: string,
  data: Omit<ImportTemplate, 'id' | 'createdAt' | 'workspaceId'>
) => ({ ...data, workspaceId });

export const apiSaveImportTemplate = (
  workspaceId: string,
  data: Omit<ImportTemplate, 'id' | 'createdAt' | 'workspaceId'>
) =>
  call<ImportTemplate>('/api/import-templates', {
    method: 'POST',
    body: JSON.stringify(buildImportTemplateSaveRequest(workspaceId, data)),
  });

export const apiFindMatchingTemplate = (workspaceId: string, headerSignature: string[]) =>
  call<ImportTemplate | null>(
    `/api/import-templates?workspaceId=${workspaceId}&headers=${encodeURIComponent(JSON.stringify(headerSignature))}`
  );

// PDF statement extraction is deliberately separate from reusable CSV/XLSX mappings.
export class PdfExtractionApiError extends Error {
  constructor(message: string, readonly code?: PdfExtractionErrorCode) {
    super(message);
    this.name = 'PdfExtractionApiError';
  }
}

export const apiGetPdfTemplates = () =>
  call<PdfTemplateSummary[]>('/api/pdf-import/templates');

export const apiExtractPdfStatement = async (file: File, templateId: string) => {
  const form = new FormData();
  form.set('templateId', templateId);
  form.set('file', file);
  const response = await fetch('/api/pdf-import/extract', { method: 'POST', body: form });
  const json = await response.json() as PdfExtractionReport | {
    error?: string;
    code?: PdfExtractionErrorCode;
  };
  if (!response.ok) {
    const failure = json as { error?: string; code?: PdfExtractionErrorCode };
    throw new PdfExtractionApiError(failure.error ?? 'PDF extraction failed.', failure.code);
  }
  return json as PdfExtractionReport;
};

// ─── Budgets ────────────────────────────────────────────────────────────────
export const apiGetBudget = (workspaceId: string, year: number) =>
  call<{ budget: Budget | null; lines: BudgetLine[] }>(`/api/budgets?workspaceId=${workspaceId}&year=${year}`);

export const apiSaveBudgetLine = (workspaceId: string, year: number, line: Partial<BudgetLine>) =>
  call<BudgetLine>('/api/budgets', { method: 'POST', body: JSON.stringify({ workspaceId, year, line }) });

export const apiDeleteBudgetLine = (workspaceId: string, year: number, categoryId: string) =>
  call<{ ok: true }>('/api/budgets', { method: 'DELETE', body: JSON.stringify({ workspaceId, year, categoryId }) });

// ─── Seed / Demo Data ──────────────────────────────────────────────────────
export const apiSeedDemoData = (workspaceId: string, clear = false) =>
  call<{ ok: true }>('/api/seed', { method: 'POST', body: JSON.stringify({ workspaceId, clear }) });
