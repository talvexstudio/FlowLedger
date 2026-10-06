export type RestoreErrorCode =
  | 'INVALID_BACKUP'
  | 'UNSUPPORTED_VERSION'
  | 'UNSUPPORTED_STORE_SCHEMA'
  | 'COUNT_MISMATCH'
  | 'HASH_MISMATCH'
  | 'REFERENTIAL_INTEGRITY_FAILURE'
  | 'RESTORE_EXECUTION_FAILURE'
  | 'INVALID_OPERATION'
  | 'DATA_OPERATION_FAILURE'
  | 'ROLLBACK_FAILURE';

export class RestoreError extends Error {
  readonly code: RestoreErrorCode;

  constructor(code: RestoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RestoreError';
    this.code = code;
  }
}

export const asRestoreError = (error: unknown) =>
  error instanceof RestoreError
    ? error
    : new RestoreError('INVALID_BACKUP', 'The selected file is not a valid FlowLedger backup.', {
        cause: error,
      });
