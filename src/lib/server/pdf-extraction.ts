import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const SUPPORTED_PDF_TEMPLATES = [
  {
    id: 'activobank-current-account-v1',
    name: 'ActivoBank Current Account',
    filename: 'activobank.json',
  },
  {
    id: 'cgd-current-account-v1',
    name: 'CGD Current Account',
    filename: 'cgd.json',
  },
  {
    id: 'revolut-current-account-v1',
    name: 'Revolut Current Account',
    filename: 'revolut-current-account.json',
  },
] as const;

export type PdfTemplateId = (typeof SUPPORTED_PDF_TEMPLATES)[number]['id'];
export type PdfTemplateSummary = Pick<(typeof SUPPORTED_PDF_TEMPLATES)[number], 'id' | 'name'>;

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
  context: Record<string, unknown>;
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
    ambiguousRows: unknown[];
    rows: PdfExtractionRow[];
  };
  reconciliation: {
    openingBalance: number | null;
    totalDebits: number;
    totalCredits: number;
    calculatedClosingBalance: number | null;
    statementClosingBalance: number | null;
    difference: number | null;
    rowContinuityFailureCount: number;
    status: 'PASS' | 'FAIL' | 'UNAVAILABLE';
    [key: string]: unknown;
  };
  scopeDiagnostics: Record<string, unknown>;
};

type RawPdfReport = PdfExtractionReport & {
  template: PdfExtractionReport['template'] & { path?: string };
  source: PdfExtractionReport['source'] & { path?: string };
  document: PdfExtractionReport['document'] & { pages?: unknown[] };
};

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_JSON_BYTES = 25 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export class PdfExtractionError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'INVALID_FILE'
      | 'UNSUPPORTED_TEMPLATE'
      | 'EXTRACTION_FAILED'
      | 'EXTRACTION_TIMEOUT'
      | 'INVALID_ENGINE_RESPONSE'
  ) {
    super(message);
    this.name = 'PdfExtractionError';
  }
}

export const listSupportedPdfTemplates = (): PdfTemplateSummary[] =>
  SUPPORTED_PDF_TEMPLATES.map(({ id, name }) => ({ id, name }));

const getTemplate = (templateId: string) => {
  const template = SUPPORTED_PDF_TEMPLATES.find((candidate) => candidate.id === templateId);
  if (!template) {
    throw new PdfExtractionError(`Unsupported PDF template: ${templateId}`, 'UNSUPPORTED_TEMPLATE');
  }
  return template;
};

const parseEngineResponse = (
  stdout: string,
  expectedTemplateId: PdfTemplateId,
  sourceFilename: string
): PdfExtractionReport => {
  let report: RawPdfReport;
  try {
    report = JSON.parse(stdout) as RawPdfReport;
  } catch {
    throw new PdfExtractionError('PDF engine returned invalid JSON.', 'INVALID_ENGINE_RESPONSE');
  }

  if (
    report?.template?.id !== expectedTemplateId ||
    !Array.isArray(report?.transactionTable?.rows) ||
    typeof report?.transactionTable?.rowCount !== 'number' ||
    typeof report?.reconciliation?.status !== 'string'
  ) {
    throw new PdfExtractionError('PDF engine returned an invalid report shape.', 'INVALID_ENGINE_RESPONSE');
  }

  const { path: _templatePath, ...template } = report.template;
  const { path: _sourcePath, ...source } = report.source;
  const { pages: _pages, ...document } = report.document;
  return {
    ...report,
    template,
    source: { ...source, filename: path.basename(sourceFilename) },
    document,
  };
};

const runPythonEngine = async (
  inputPath: string,
  templatePath: string,
  templateId: PdfTemplateId,
  sourceFilename: string,
  timeoutMs: number
) => {
  const repositoryRoot = process.cwd();
  const scriptPath = path.join(repositoryRoot, 'scripts', 'pdf-inspect', 'extract_pdf_json.py');
  const pythonExecutable = process.env.PDF_IMPORT_PYTHON?.trim() ||
    (process.platform === 'win32' ? 'python' : 'python3');

  return new Promise<PdfExtractionReport>((resolve, reject) => {
    const child = spawn(
      pythonExecutable,
      [scriptPath, '--template', templatePath, '--input', inputPath],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: '1',
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
        },
        shell: false,
        windowsHide: true,
      }
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;

    const fail = (error: PdfExtractionError) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const timer = setTimeout(() => {
      child.kill();
      fail(new PdfExtractionError('PDF extraction timed out.', 'EXTRACTION_TIMEOUT'));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_JSON_BYTES) {
        child.kill();
        fail(new PdfExtractionError('PDF engine output exceeded the safety limit.', 'EXTRACTION_FAILED'));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      fail(new PdfExtractionError(`Could not start the PDF engine: ${error.message}`, 'EXTRACTION_FAILED'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString('utf8').trim();
        fail(new PdfExtractionError(detail || `PDF engine exited with code ${code}.`, 'EXTRACTION_FAILED'));
        return;
      }
      try {
        const report = parseEngineResponse(
          Buffer.concat(stdout).toString('utf8'),
          templateId,
          sourceFilename
        );
        settled = true;
        resolve(report);
      } catch (error) {
        fail(
          error instanceof PdfExtractionError
            ? error
            : new PdfExtractionError('Could not read the PDF engine response.', 'INVALID_ENGINE_RESPONSE')
        );
      }
    });
  });
};

export const extractPdfStatement = async (
  pdfBytes: Uint8Array,
  sourceFilename: string,
  templateId: string,
  options?: { timeoutMs?: number }
): Promise<PdfExtractionReport> => {
  if (pdfBytes.byteLength === 0 || pdfBytes.byteLength > MAX_PDF_BYTES) {
    throw new PdfExtractionError('PDF must be between 1 byte and 25 MB.', 'INVALID_FILE');
  }
  if (Buffer.from(pdfBytes.subarray(0, 5)).toString('ascii') !== '%PDF-') {
    throw new PdfExtractionError('The uploaded file is not a valid PDF.', 'INVALID_FILE');
  }

  const template = getTemplate(templateId);
  const repositoryRoot = process.cwd();
  const templatePath = path.join(
    repositoryRoot,
    'scripts',
    'pdf-inspect',
    'templates',
    template.filename
  );
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'flowledger-pdf-'));
  const inputPath = path.join(temporaryDirectory, 'statement.pdf');

  try {
    await writeFile(inputPath, pdfBytes);
    await readFile(templatePath);
    return await runPythonEngine(
      inputPath,
      templatePath,
      template.id,
      sourceFilename,
      options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    );
  } finally {
    await unlink(inputPath).catch(() => undefined);
    await rmdir(temporaryDirectory).catch(() => undefined);
  }
};
