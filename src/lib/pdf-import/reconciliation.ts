import type { PdfExtractionReport } from './types';

export type PdfReconciliationGate = {
  displayStatus: 'PASS' | 'WARNING' | 'UNAVAILABLE';
  requiresAcknowledgement: boolean;
  blocked: boolean;
  canContinue: boolean;
  reason: string;
};

export const evaluatePdfReconciliation = (
  reconciliation: PdfExtractionReport['reconciliation'],
  acknowledged: boolean
): PdfReconciliationGate => {
  if (reconciliation.status === 'PASS') {
    return {
      displayStatus: 'PASS',
      requiresAcknowledgement: false,
      blocked: false,
      canContinue: true,
      reason: 'Statement balances reconcile.',
    };
  }

  if (
    reconciliation.mode === 'FULL_RECONCILIATION' &&
    reconciliation.status === 'UNAVAILABLE'
  ) {
    return {
      displayStatus: 'UNAVAILABLE',
      requiresAcknowledgement: false,
      blocked: true,
      canContinue: false,
      reason: 'Full reconciliation was expected but could not be completed.',
    };
  }

  if (reconciliation.mode === 'NONE' || reconciliation.status === 'SKIPPED') {
    return {
      displayStatus: 'UNAVAILABLE',
      requiresAcknowledgement: true,
      blocked: false,
      canContinue: acknowledged,
      reason: 'This template does not provide statement reconciliation.',
    };
  }

  return {
    displayStatus: 'WARNING',
    requiresAcknowledgement: true,
    blocked: false,
    canContinue: acknowledged,
    reason: 'The extracted transactions do not fully reconcile with the statement balances.',
  };
};

export type PdfAcknowledgementState = {
  acknowledged: boolean;
  fileKey: string | null;
  templateId: string | null;
};

export type PdfAcknowledgementEvent =
  | { type: 'ACKNOWLEDGE'; value: boolean }
  | { type: 'FILE_CHANGED'; fileKey: string | null }
  | { type: 'TEMPLATE_CHANGED'; templateId: string | null };

export const reducePdfAcknowledgement = (
  state: PdfAcknowledgementState,
  event: PdfAcknowledgementEvent
): PdfAcknowledgementState => {
  if (event.type === 'ACKNOWLEDGE') return { ...state, acknowledged: event.value };
  if (event.type === 'FILE_CHANGED') {
    return event.fileKey === state.fileKey
      ? state
      : { ...state, fileKey: event.fileKey, acknowledged: false };
  }
  return event.templateId === state.templateId
    ? state
    : { ...state, templateId: event.templateId, acknowledged: false };
};
