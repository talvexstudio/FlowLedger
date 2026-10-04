import type { PdfExtractionErrorCode } from './types';

const messages: Partial<Record<PdfExtractionErrorCode, string>> = {
  NO_SELECTABLE_TEXT:
    'This PDF appears scanned or image-only. PDF Import V1 supports selectable-text statements only.',
  TEMPLATE_MISMATCH: 'This statement does not match the selected PDF template.',
  LEDGER_NOT_FOUND: 'The transaction table could not be found.',
  NO_TRANSACTIONS: 'No transactions were extracted.',
  PROCESS_TIMEOUT: 'PDF extraction took too long and was stopped.',
  PYTHON_UNAVAILABLE: 'The local PDF extraction runtime is unavailable.',
  DEPENDENCY_MISSING: 'The local PDF extraction runtime is unavailable.',
  UNSUPPORTED_TEMPLATE: 'The selected PDF template is not supported.',
  INVALID_FILE: 'The selected file is not a valid PDF.',
  INVALID_ENGINE_RESPONSE: 'The PDF extractor returned an invalid response.',
  EXTRACTION_FAILED: 'The PDF could not be extracted.',
};

export const getPdfExtractionErrorMessage = (code?: string) =>
  (code && messages[code as PdfExtractionErrorCode]) || 'The PDF could not be extracted.';
