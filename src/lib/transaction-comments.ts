export const TRANSACTION_COMMENTS_MAX_LENGTH = 2_000;

export class TransactionCommentsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransactionCommentsValidationError';
  }
}

export const normalizeTransactionCommentsValue = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new TransactionCommentsValidationError('Comments must be plain text.');
  }
  const normalized = value.trim();
  if (normalized.length > TRANSACTION_COMMENTS_MAX_LENGTH) {
    throw new TransactionCommentsValidationError(
      `Comments must be ${TRANSACTION_COMMENTS_MAX_LENGTH.toLocaleString()} characters or fewer.`
    );
  }
  return normalized || undefined;
};

export const normalizeTransactionComments = <T extends { comments?: unknown }>(transaction: T): T => {
  if (!Object.prototype.hasOwnProperty.call(transaction, 'comments')) return transaction;
  const comments = normalizeTransactionCommentsValue(transaction.comments);
  const { comments: _discarded, ...withoutComments } = transaction;
  return (comments === undefined ? withoutComments : { ...withoutComments, comments }) as T;
};

export const TRANSACTION_TABLE_COLUMN_LABELS = [
  'Date',
  'Account',
  'Description',
  'Category',
  'Comments',
  'Amount',
  'Actions',
] as const;

export const getTransactionCommentDisplay = (comments: unknown): string =>
  typeof comments === 'string' ? comments.trim() : '';
