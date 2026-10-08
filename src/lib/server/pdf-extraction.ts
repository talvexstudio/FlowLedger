import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  PdfExtractionErrorCode,
  PdfExtractionReport,
  PdfParserDetectionResult,
  PdfTemplateId,
  PdfTemplateSummary,
} from '@/lib/pdf-import/types';

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

type RawPdfReport = PdfExtractionReport & {
  template: PdfExtractionReport['template'] & { path?: string };
  source: PdfExtractionReport['source'] & { path?: string };
  document: PdfExtractionReport['document'] & { pages?: unknown[] };
};

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_JSON_BYTES = 25 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

const engineFailure = (stderr: string) => {
  try {
    const failure = JSON.parse(stderr) as { code?: PdfExtractionErrorCode };
    if (failure.code === 'NO_SELECTABLE_TEXT') {
      return new PdfExtractionError(
        'This PDF appears scanned or image-only. PDF Import V1 supports selectable-text statements only.',
        failure.code
      );
    }
    if (failure.code === 'TEMPLATE_MISMATCH') {
      return new PdfExtractionError(
        'This statement does not match the selected PDF template.',
        failure.code
      );
    }
  } catch {
    // Older/local wrappers may still return plain stderr; retain safe fallback classification.
  }
  if (/does not match template/i.test(stderr)) {
    return new PdfExtractionError(
      'This statement does not match the selected PDF template.',
      'TEMPLATE_MISMATCH'
    );
  }
  if (/no module named ['"]?(pymupdf|fitz)/i.test(stderr)) {
    return new PdfExtractionError(
      'The local PDF extraction dependency is unavailable.',
      'DEPENDENCY_MISSING'
    );
  }
  return new PdfExtractionError('The PDF could not be extracted.', 'EXTRACTION_FAILED');
};

export class PdfExtractionError extends Error {
  constructor(
    message: string,
    readonly code: PdfExtractionErrorCode
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

const parseDetectionResponse = (stdout: string): PdfParserDetectionResult => {
  let result: PdfParserDetectionResult;
  try {
    result = JSON.parse(stdout) as PdfParserDetectionResult;
  } catch {
    throw new PdfExtractionError('PDF detector returned invalid JSON.', 'INVALID_ENGINE_RESPONSE');
  }
  const decisions = new Set(['single_match', 'multiple_matches', 'no_match', 'unusable_pdf']);
  if (
    !decisions.has(result?.decision) ||
    !Array.isArray(result?.candidates) ||
    typeof result?.document?.pageCount !== 'number' ||
    typeof result?.document?.selectableTextPageCount !== 'number' ||
    result.candidates.some((candidate) =>
      !SUPPORTED_PDF_TEMPLATES.some((template) => template.id === candidate.parserId) ||
      typeof candidate.displayName !== 'string' ||
      typeof candidate.matched !== 'boolean' ||
      !Array.isArray(candidate.reasons) ||
      typeof candidate.evidence?.identification !== 'boolean' ||
      typeof candidate.evidence?.section !== 'boolean' ||
      typeof candidate.evidence?.tableHeader !== 'boolean'
    )
  ) {
    throw new PdfExtractionError('PDF detector returned an invalid response shape.', 'INVALID_ENGINE_RESPONSE');
  }
  return result;
};

const runPythonJson = async <T>(
  scriptName: string,
  args: string[],
  timeoutMs: number,
  parseResponse: (stdout: string) => T
) => {
  const repositoryRoot = process.cwd();
  const scriptPath = path.join(repositoryRoot, 'scripts', 'pdf-inspect', scriptName);
  const pythonExecutable = process.env.PDF_IMPORT_PYTHON?.trim() ||
    (process.platform === 'win32' ? 'python' : 'python3');

  return new Promise<T>((resolve, reject) => {
    const child = spawn(
      pythonExecutable,
      [scriptPath, ...args],
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
      fail(new PdfExtractionError('PDF extraction took too long and was stopped.', 'PROCESS_TIMEOUT'));
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
      fail(new PdfExtractionError(
        error.message.includes('ENOENT')
          ? 'The local PDF extraction runtime is unavailable.'
          : 'The PDF extraction process could not be started.',
        error.message.includes('ENOENT') ? 'PYTHON_UNAVAILABLE' : 'EXTRACTION_FAILED'
      ));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString('utf8').trim();
        fail(engineFailure(detail));
        return;
      }
      try {
        const report = parseResponse(Buffer.concat(stdout).toString('utf8'));
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

const runPythonEngine = (
  inputPath: string,
  templatePath: string,
  templateId: PdfTemplateId,
  sourceFilename: string,
  timeoutMs: number
) => runPythonJson(
  'extract_pdf_json.py',
  ['--template', templatePath, '--input', inputPath],
  timeoutMs,
  (stdout) => parseEngineResponse(stdout, templateId, sourceFilename)
);

const validatePdfBytes = (pdfBytes: Uint8Array) => {
  if (pdfBytes.byteLength === 0 || pdfBytes.byteLength > MAX_PDF_BYTES) {
    throw new PdfExtractionError('PDF must be between 1 byte and 25 MB.', 'INVALID_FILE');
  }
  if (Buffer.from(pdfBytes.subarray(0, 5)).toString('ascii') !== '%PDF-') {
    throw new PdfExtractionError('The uploaded file is not a valid PDF.', 'INVALID_FILE');
  }
};

const templatePathFor = (filename: string) => path.join(
  process.cwd(),
  'scripts',
  'pdf-inspect',
  'templates',
  filename
);

export const detectPdfStatement = async (
  pdfBytes: Uint8Array,
  options?: { timeoutMs?: number }
): Promise<PdfParserDetectionResult> => {
  validatePdfBytes(pdfBytes);
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'flowledger-pdf-'));
  const inputPath = path.join(temporaryDirectory, 'statement.pdf');
  const templatePaths = SUPPORTED_PDF_TEMPLATES.map((template) => templatePathFor(template.filename));

  try {
    await writeFile(inputPath, pdfBytes);
    await Promise.all(templatePaths.map((templatePath) => readFile(templatePath)));
    const templateArgs = templatePaths.flatMap((templatePath) => ['--template', templatePath]);
    return await runPythonJson(
      'detect_pdf_json.py',
      [...templateArgs, '--input', inputPath],
      options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      parseDetectionResponse
    );
  } finally {
    await unlink(inputPath).catch(() => undefined);
    await rmdir(temporaryDirectory).catch(() => undefined);
  }
};

export const extractPdfStatement = async (
  pdfBytes: Uint8Array,
  sourceFilename: string,
  templateId: string,
  options?: { timeoutMs?: number }
): Promise<PdfExtractionReport> => {
  validatePdfBytes(pdfBytes);

  const template = getTemplate(templateId);
  const templatePath = templatePathFor(template.filename);
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'flowledger-pdf-'));
  const inputPath = path.join(temporaryDirectory, 'statement.pdf');

  try {
    await writeFile(inputPath, pdfBytes);
    await readFile(templatePath);
    const report = await runPythonEngine(
      inputPath,
      templatePath,
      template.id,
      sourceFilename,
      options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    );
    if (!report.document.selectableText) {
      throw new PdfExtractionError(
        'This PDF appears scanned or image-only. PDF Import V1 supports selectable-text statements only.',
        'NO_SELECTABLE_TEXT'
      );
    }
    if (report.transactionTable.detectedPages.length === 0) {
      throw new PdfExtractionError('The transaction table could not be found.', 'LEDGER_NOT_FOUND');
    }
    if (report.transactionTable.rowCount === 0) {
      throw new PdfExtractionError('No transactions were extracted.', 'NO_TRANSACTIONS');
    }
    return report;
  } finally {
    await unlink(inputPath).catch(() => undefined);
    await rmdir(temporaryDirectory).catch(() => undefined);
  }
};
