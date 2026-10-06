import { db } from "./firestore";
import type { Category, ClassificationRule, Subcategory, Transaction } from "../types";
import { normalizeTransactionTypeFields } from '../internal-transfer';
import { requireAccount } from './accounts';

const rulesCollection = (workspaceId: string) => `workspaces/${workspaceId}/rules`;

export const getRules = async (workspaceId: string): Promise<ClassificationRule[]> => {
  const snapshot = await db.collection(rulesCollection(workspaceId)).get();
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  } as ClassificationRule));
};

export const saveRule = async (
  workspaceId: string,
  data: ClassificationRule | Omit<ClassificationRule, "id">
): Promise<ClassificationRule> => {
  if (data.match.accountId) {
    await requireAccount(workspaceId, data.match.accountId);
  }
  // Category ownership remains intentionally global until workspace-owned
  // categories are introduced in Workspace Phase 3.
  const coll = db.collection(rulesCollection(workspaceId));
  if ("id" in data && data.id) {
    const { id, ...payload } = data;
    await coll.doc(id).set(payload, { merge: true });
    return { ...payload, id } as ClassificationRule;
  }

  const docRef = await coll.add(data);
  return { ...(data as Omit<ClassificationRule, "id">), id: docRef.id };
};

export const deleteRule = async (
  workspaceId: string,
  ruleId: string
): Promise<void> => {
  await db.collection(rulesCollection(workspaceId)).doc(ruleId).delete();
};

export const applyRulesToTransaction = (
  tx: Partial<Transaction>,
  rules: ClassificationRule[]
): Partial<Transaction> => {
  let result = { ...tx };
  let ruleAssignedInternalTransfer = false;
  const desc = (tx.rawDescription || tx.description || "").toLowerCase();
  const amount = Math.abs(tx.amountBase ?? 0);

  for (const rule of rules) {
    const m = rule.match;

    if (m.descriptionContains && !desc.includes(m.descriptionContains.toLowerCase())) {
      continue;
    }
    if (m.accountId && tx.accountId && tx.accountId !== m.accountId) {
      continue;
    }
    if (typeof m.minAmount === "number" && amount < m.minAmount) {
      continue;
    }
    if (typeof m.maxAmount === "number" && amount > m.maxAmount) {
      continue;
    }
    if (rule.action.type === 'InternalTransfer') ruleAssignedInternalTransfer = true;

    result = {
      ...result,
      categoryId: rule.action.categoryId ?? result.categoryId,
      subcategoryId: rule.action.subcategoryId ?? result.subcategoryId,
      type: rule.action.type ?? result.type,
    };
  }

  const normalized = normalizeTransactionTypeFields(result);
  return ruleAssignedInternalTransfer
    ? { ...normalized, needsReview: true }
    : normalized;
};

const DESCRIPTION_STOPWORDS = new Set([
  "compra",
  "compras",
  "pagamento",
  "pagamentos",
  "pag",
  "pgto",
  "transferencia",
  "transf",
  "mbway",
  "visa",
  "mastercard",
  "debito",
  "credito",
  "cartao",
  "rev",
  "revolut",
]);

export const tokenizeDescription = (text: string): string[] => {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !DESCRIPTION_STOPWORDS.has(token));
};

export const descriptionSimilarity = (pattern: string, candidate: string): number => {
  const patternTokens = new Set(tokenizeDescription(pattern));
  const candidateTokens = new Set(tokenizeDescription(candidate));

  if (patternTokens.size === 0) return 0;

  let intersect = 0;
  patternTokens.forEach((token) => {
    if (candidateTokens.has(token)) {
      intersect += 1;
    }
  });

  return intersect / patternTokens.size;
};

export const ruleMatchesTransactionForBackfill = (
  rule: ClassificationRule,
  tx: Transaction,
  similarityThreshold: number = 0.6
): boolean => {
  if (rule.match.accountId && rule.match.accountId !== tx.accountId) {
    return false;
  }

  const pattern = (rule.match.descriptionContains || "").trim();
  if (!pattern) return false;

  const candidateDesc = (tx.rawDescription || tx.description || "").trim();
  if (!candidateDesc) return false;

  const score = descriptionSimilarity(pattern, candidateDesc);
  return score >= similarityThreshold;
};

export const applyRuleClassificationToTransaction = (
  tx: Transaction,
  rule: ClassificationRule,
  categories: (Category & { subcategories: Subcategory[] })[]
): Partial<Transaction> => {
  const updated: Partial<Transaction> = { id: tx.id };

  if (rule.action.categoryId) {
    updated.categoryId = rule.action.categoryId;
  }

  if (rule.action.subcategoryId) {
    updated.subcategoryId = rule.action.subcategoryId;
    const category = categories.find((cat) =>
      cat.subcategories?.some((sub) => sub.id === rule.action.subcategoryId)
    );
    const subcategory = category?.subcategories.find(
      (sub) => sub.id === rule.action.subcategoryId
    );
    if (subcategory?.flowType) {
      updated.type = subcategory.flowType;
    }
  }

  if (!updated.type && rule.action.type) {
    updated.type = rule.action.type;
  }

  const normalized = normalizeTransactionTypeFields({ ...tx, ...updated });
  if (normalized.type === 'InternalTransfer') {
    return {
      id: tx.id,
      type: 'InternalTransfer',
      categoryId: undefined,
      subcategoryId: undefined,
      isInternalTransfer: true,
      needsReview: true,
    };
  }

  updated.needsReview = false;

  return updated;
};
