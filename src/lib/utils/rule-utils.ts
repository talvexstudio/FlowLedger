// Pure rule-matching utilities — no database access, safe to import in client components.

import type { Account, Category, ClassificationRule, Subcategory, Transaction } from '@/lib/types';
import { normalizeTransactionTypeFields } from '@/lib/internal-transfer';
import { needsReviewAfterClassification } from '@/lib/transaction-review';

export type RuleMatchMethod = 'literal' | 'stable-token';

export type RuleApplicationResult = {
  transaction: Partial<Transaction>;
  matchedRules: ClassificationRule[];
  conflict: boolean;
  conflictReason?: string;
};

type DescriptionToken = {
  source: string;
  normalized: string;
  alphabetic: boolean;
  volatile: boolean;
  boilerplate: boolean;
};

const BOILERPLATE_TOKENS = new Set([
  'COMPRA', 'COMPRAS', 'PAGAMENTO', 'PAGAMENTOS', 'PAG', 'PGTO',
  'TRANSFERENCIA', 'TRANSF', 'MBWAY', 'VISA', 'MASTERCARD',
  'DEBITO', 'CREDITO', 'CARTAO', 'REV', 'REVOLUT', 'CONTACTLESS',
]);

export const normalizeRuleText = (text: string): string => text
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const descriptionTokens = (text: string): DescriptionToken[] => {
  const sourceTokens = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  return sourceTokens.map((source) => {
    const normalized = normalizeRuleText(source);
    return {
      source,
      normalized,
      alphabetic: /^\p{L}+$/u.test(normalized),
      // Only standalone all-numeric tokens are treated as volatile. Embedded
      // merchant identifiers such as LOJA24 or A1B2 remain intact.
      volatile: /^\d{2,}$/.test(normalized),
      boilerplate: BOILERPLATE_TOKENS.has(normalized),
    };
  }).filter((token) => token.normalized.length > 0);
};

const stableDescriptionTokens = (text: string): DescriptionToken[] =>
  descriptionTokens(text).filter((token) =>
    !token.volatile && !token.boilerplate && token.normalized.length >= 2
  );

export const suggestStableDescriptionPattern = (description: string): string => {
  const source = description.trim().replace(/\s+/g, ' ');
  const stable = stableDescriptionTokens(source);
  const meaningfulAlphabetic = stable.filter((token) => token.alphabetic);
  if (meaningfulAlphabetic.length < 2) return source;
  return stable.slice(0, 3).map((token) => token.source).join(' ');
};

const orderedTokensMatch = (patternTokens: string[], candidateTokens: string[]) => {
  if (patternTokens.length === 0) return false;
  let candidateIndex = 0;
  for (const patternToken of patternTokens) {
    const foundAt = candidateTokens.indexOf(patternToken, candidateIndex);
    if (foundAt === -1) return false;
    candidateIndex = foundAt + 1;
  }
  return true;
};

export const matchRuleDescription = (
  rule: ClassificationRule,
  description: string
): RuleMatchMethod | null => {
  const pattern = rule.match.descriptionContains?.trim();
  if (!pattern) return null;
  const mode = rule.match.matchMode ?? 'contains';
  const normalizedDescription = description.trimStart().toLocaleLowerCase();
  const normalizedPattern = pattern.toLocaleLowerCase();
  if (mode === 'starts_with') {
    return normalizedDescription.startsWith(normalizedPattern) ? 'literal' : null;
  }
  if (normalizedDescription.includes(normalizedPattern)) return 'literal';
  if (!rule.createdFromTransactionId) return null;

  const stablePattern = stableDescriptionTokens(pattern);
  if (stablePattern.filter((token) => token.alphabetic).length < 2) return null;
  const candidate = stableDescriptionTokens(description).map((token) => token.normalized);
  return orderedTokensMatch(stablePattern.map((token) => token.normalized), candidate)
    ? 'stable-token'
    : null;
};

export const ruleMatchesTransaction = (
  rule: ClassificationRule,
  tx: Partial<Transaction>
): RuleMatchMethod | null => {
  if (tx.workspaceId && rule.workspaceId !== tx.workspaceId) return null;
  if (rule.match.accountId && rule.match.accountId !== tx.accountId) return null;
  const amount = Math.abs(tx.amountBase ?? 0);
  if (typeof rule.match.minAmount === 'number' && amount < rule.match.minAmount) return null;
  if (typeof rule.match.maxAmount === 'number' && amount > rule.match.maxAmount) return null;
  return matchRuleDescription(rule, tx.rawDescription || tx.description || '');
};

const actionSignature = (rule: ClassificationRule, tx: Partial<Transaction>) => {
  const type = rule.action.type ?? tx.type ?? null;
  return JSON.stringify({
    type,
    categoryId: type === 'InternalTransfer'
      ? null
      : rule.action.categoryId ?? tx.categoryId ?? null,
    subcategoryId: type === 'InternalTransfer'
      ? null
      : rule.action.subcategoryId ?? tx.subcategoryId ?? null,
    internalDirection: type === 'InternalTransfer'
      ? rule.action.internalDirection ?? tx.internalDirection ?? null
      : null,
    destinationAccountId: type === 'InternalTransfer'
      ? rule.action.destinationAccountId ?? tx.destinationAccountId ?? null
      : null,
  });
};

export const applyRulesToTransactionWithResult = (
  tx: Partial<Transaction>,
  rules: ClassificationRule[]
): RuleApplicationResult => {
  const matchedRules = rules.filter((rule) => ruleMatchesTransaction(rule, tx) !== null);
  if (matchedRules.length === 0) {
    return { transaction: { ...tx }, matchedRules, conflict: false };
  }
  if (new Set(matchedRules.map((rule) => actionSignature(rule, tx))).size > 1) {
    return {
      transaction: { ...tx, needsReview: true },
      matchedRules,
      conflict: true,
      conflictReason: 'More than one matching rule proposes a different classification.',
    };
  }

  const action = matchedRules[0].action;
  const result = normalizeTransactionTypeFields({
    ...tx,
    categoryId: action.categoryId ?? tx.categoryId,
    subcategoryId: action.subcategoryId ?? tx.subcategoryId,
    type: action.type ?? tx.type,
    internalDirection: action.internalDirection ?? tx.internalDirection,
    destinationAccountId: action.destinationAccountId ?? tx.destinationAccountId,
  });
  return {
    transaction: action.type === 'InternalTransfer'
      ? { ...result, needsReview: true }
      : result,
    matchedRules,
    conflict: false,
  };
};

export const applyRulesToTransaction = (
  tx: Partial<Transaction>,
  rules: ClassificationRule[]
): Partial<Transaction> => applyRulesToTransactionWithResult(tx, rules).transaction;

export const tokenizeDescription = (text: string): string[] =>
  stableDescriptionTokens(text).map((token) => token.normalized.toLocaleLowerCase());

export const descriptionSimilarity = (pattern: string, candidate: string): number => {
  const patternTokens = new Set(tokenizeDescription(pattern));
  const candidateTokens = new Set(tokenizeDescription(candidate));
  if (patternTokens.size === 0) return 0;
  let intersect = 0;
  patternTokens.forEach((t) => { if (candidateTokens.has(t)) intersect++; });
  return intersect / patternTokens.size;
};

export const ruleMatchesTransactionForBackfill = (
  rule: ClassificationRule,
  tx: Transaction,
  _similarityThreshold = 0.6
): boolean => {
  return ruleMatchesTransaction(rule, tx) !== null;
};

export const transactionAlreadyHasRuleResult = (
  transaction: Transaction,
  rule: ClassificationRule
) => transaction.type === (rule.action.type ?? transaction.type) &&
  (!rule.action.categoryId || transaction.categoryId === rule.action.categoryId) &&
  (!rule.action.subcategoryId || transaction.subcategoryId === rule.action.subcategoryId) &&
  (rule.action.type !== 'InternalTransfer' || (
    transaction.internalDirection === rule.action.internalDirection &&
    transaction.destinationAccountId === rule.action.destinationAccountId
  ));

export const getRuleBackfillCandidates = (
  rule: ClassificationRule,
  transactions: Transaction[],
  excludedTransactionId?: string
) => transactions.filter((transaction) =>
  transaction.id !== excludedTransactionId &&
  ruleMatchesTransactionForBackfill(rule, transaction) &&
  !transactionAlreadyHasRuleResult(transaction, rule)
);

export const applyRuleClassificationToTransaction = (
  tx: Transaction,
  rule: ClassificationRule,
  categories: (Category & { subcategories: Subcategory[] })[],
  accounts: Account[] = []
): Partial<Transaction> => {
  const updated: Partial<Transaction> = { id: tx.id };

  if (rule.action.categoryId) updated.categoryId = rule.action.categoryId;

  if (rule.action.subcategoryId) {
    updated.subcategoryId = rule.action.subcategoryId;
    const category = categories.find((c) =>
      c.subcategories?.some((s) => s.id === rule.action.subcategoryId)
    );
    const sub = category?.subcategories.find((s) => s.id === rule.action.subcategoryId);
    if (sub?.flowType) updated.type = sub.flowType;
  }

  if (!updated.type && rule.action.type) updated.type = rule.action.type;
  if (rule.action.type === 'InternalTransfer') {
    updated.internalDirection = rule.action.internalDirection;
    updated.destinationAccountId = rule.action.destinationAccountId;
  }
  const normalized = normalizeTransactionTypeFields({ ...tx, ...updated });
  const patch: Partial<Transaction> = normalized.type === 'InternalTransfer'
    ? {
        id: tx.id,
        type: 'InternalTransfer' as const,
        categoryId: undefined,
        subcategoryId: undefined,
        isInternalTransfer: true,
        internalDirection: normalized.internalDirection,
        destinationAccountId: normalized.destinationAccountId,
      }
    : updated;
  patch.needsReview = needsReviewAfterClassification(
    { ...tx, ...patch },
    categories,
    accounts,
    tx.workspaceId
  );
  if (patch.type === 'InternalTransfer' && !tx.linkedTransactionId) {
    patch.needsReview = true;
  }
  return patch;
};
