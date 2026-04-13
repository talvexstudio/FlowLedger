// Pure rule-matching utilities — no database access, safe to import in client components.

import type { Category, ClassificationRule, Subcategory, Transaction } from '@/lib/types';

export const applyRulesToTransaction = (
  tx: Partial<Transaction>,
  rules: ClassificationRule[]
): Partial<Transaction> => {
  let result = { ...tx };
  const desc = (tx.rawDescription || tx.description || '').toLowerCase();
  const amount = Math.abs(tx.amountBase ?? 0);

  for (const rule of rules) {
    const m = rule.match;
    if (m.descriptionContains && !desc.includes(m.descriptionContains.toLowerCase())) continue;
    if (m.accountId && tx.accountId && tx.accountId !== m.accountId) continue;
    if (typeof m.minAmount === 'number' && amount < m.minAmount) continue;
    if (typeof m.maxAmount === 'number' && amount > m.maxAmount) continue;
    result = {
      ...result,
      categoryId: rule.action.categoryId ?? result.categoryId,
      subcategoryId: rule.action.subcategoryId ?? result.subcategoryId,
      type: rule.action.type ?? result.type,
    };
  }
  return result;
};

const STOPWORDS = new Set([
  'compra', 'compras', 'pagamento', 'pagamentos', 'pag', 'pgto',
  'transferencia', 'transf', 'mbway', 'visa', 'mastercard',
  'debito', 'credito', 'cartao', 'rev', 'revolut',
]);

export const tokenizeDescription = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));

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
  similarityThreshold = 0.6
): boolean => {
  if (rule.match.accountId && rule.match.accountId !== tx.accountId) return false;
  const pattern = (rule.match.descriptionContains || '').trim();
  if (!pattern) return false;
  const candidate = (tx.rawDescription || tx.description || '').trim();
  if (!candidate) return false;
  return descriptionSimilarity(pattern, candidate) >= similarityThreshold;
};

export const applyRuleClassificationToTransaction = (
  tx: Transaction,
  rule: ClassificationRule,
  categories: (Category & { subcategories: Subcategory[] })[]
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
  updated.needsReview = false;
  return updated;
};
