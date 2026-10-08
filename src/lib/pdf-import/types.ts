export type PdfTemplateId =
  | 'activobank-current-account-v1'
  | 'cgd-current-account-v1'
  | 'revolut-current-account-v1';

export type PdfTemplateSummary = {
  id: PdfTemplateId;
  name: string;
};

export type PdfParserDetectionCandidate = {
  parserId: PdfTemplateId;
  displayName: string;
  matched: boolean;
  evidence: {
    identification: boolean;
    section: boolean;
    tableHeader: boolean;
  };
  reasons: string[];
};

export type PdfParserDetectionResult = {
  decision: 'single_match' | 'multiple_matches' | 'no_match' | 'unusable_pdf';
  candidates: PdfParserDetectionCandidate[];
  document: {
    pageCount: number;
    selectableTextPageCount: number;
  };
};

export type PdfExtractionRow = {
  postingDateRaw: string | null;
  valueDateRaw: string | null;
  postingDate: string | null;
  valueDate: string | null;
  description: string;
  signedAmountRaw: string | null;
  debitRaw: string | null;
  creditRaw: string | null;
  balanceRaw: string | null;
  page: number;
  source: {
    bbox: [number, number, number, number];
    y: number;
  };
};

export type PdfAmbiguousRow = {
  page: number;
  y: number;
  text: string;
  reasons: string[];
};

export type PdfExtractionReport = {
  reportVersion: number;
  engineVersion: string;
  template: {
    schemaVersion: number;
    id: PdfTemplateId;
    name: string;
  };
  source: {
    filename: string;
  };
  document: {
    pageCount: number;
    selectableText: boolean;
  };
  context: {
    currency?: { value?: string; raw?: string };
    openingBalance?: { numeric?: number; raw?: string };
    closingBalance?: { numeric?: number; raw?: string };
    [key: string]: unknown;
  };
  transactionTable: {
    amountModel: 'SIGNED_AMOUNT' | 'DEBIT_CREDIT';
    dateModel: 'FULL_DATE' | 'ABBREVIATED_WITH_STATEMENT_PERIOD';
    primaryDateRole: 'postingDate' | 'valueDate';
    detectedPages: Array<{ page: number; rowCount: number }>;
    rowCount: number;
    signedAmountRowCount: number;
    debitRowCount: number;
    creditRowCount: number;
    ambiguousRowCount: number;
    ambiguousRows: PdfAmbiguousRow[];
    rows: PdfExtractionRow[];
  };
  reconciliation: {
    mode: 'FULL_RECONCILIATION' | 'OPEN_CLOSE_RECONCILIATION' | 'NONE';
    openingBalance?: number | null;
    totalDebits?: number;
    totalCredits?: number;
    calculatedClosingBalance?: number | null;
    statementClosingBalance?: number | null;
    difference?: number | null;
    rowContinuityFailureCount?: number;
    status: 'PASS' | 'FAIL' | 'UNAVAILABLE' | 'SKIPPED';
    [key: string]: unknown;
  };
  scopeDiagnostics: Record<string, unknown>;
};

export type PdfExtractionErrorCode =
  | 'INVALID_FILE'
  | 'UNSUPPORTED_TEMPLATE'
  | 'NO_SELECTABLE_TEXT'
  | 'TEMPLATE_MISMATCH'
  | 'LEDGER_NOT_FOUND'
  | 'NO_TRANSACTIONS'
  | 'PROCESS_TIMEOUT'
  | 'PYTHON_UNAVAILABLE'
  | 'DEPENDENCY_MISSING'
  | 'EXTRACTION_FAILED'
  | 'INVALID_ENGINE_RESPONSE';
