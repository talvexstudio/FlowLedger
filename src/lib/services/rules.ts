import { db } from "./firestore";
import type { Category, ClassificationRule, Subcategory, Transaction } from "../types";
import { requireAccount } from './accounts';
import { getCategories } from './categories';
import { validateCategorySelection } from '../category-ownership';
import { assertWorkspaceDocumentExists, assertWorkspaceExists } from './workspace-integrity';
import {
  applyRuleClassificationToTransaction as applyRuleClassification,
  applyRulesToTransaction as applyRules,
  descriptionSimilarity,
  ruleMatchesTransactionForBackfill as ruleMatchesForBackfill,
  tokenizeDescription,
} from '../utils/rule-utils';

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
  await assertWorkspaceExists(workspaceId);
  if (data.match.accountId) {
    await requireAccount(workspaceId, data.match.accountId);
  }
  if (data.match.matchMode && data.match.matchMode !== 'contains' && data.match.matchMode !== 'starts_with') {
    throw new Error('Unsupported description match mode.');
  }
  if (data.action.type === 'InternalTransfer') {
    if (!data.match.accountId) {
      throw new Error('An InternalTransfer rule must be scoped to an account.');
    }
    if (data.action.internalDirection !== 'In' && data.action.internalDirection !== 'Out') {
      throw new Error('Choose an InternalTransfer direction.');
    }
    if (!data.action.destinationAccountId) {
      throw new Error('Choose an InternalTransfer counterpart account.');
    }
    if (data.action.destinationAccountId === data.match.accountId) {
      throw new Error('The counterpart account must be different from the rule account.');
    }
    await requireAccount(workspaceId, data.action.destinationAccountId);
    if (data.action.categoryId || data.action.subcategoryId) {
      throw new Error('InternalTransfer rules cannot assign a category or subcategory.');
    }
  }
  if (data.action.categoryId || data.action.subcategoryId) {
    validateCategorySelection(
      await getCategories(workspaceId),
      workspaceId,
      data.action.categoryId,
      data.action.subcategoryId
    );
  }
  const coll = db.collection(rulesCollection(workspaceId));
  if ("id" in data && data.id) {
    await assertWorkspaceDocumentExists(workspaceId, 'rules', data.id, 'Rule');
    const { id, workspaceId: _workspaceId, ...ruleData } = data;
    const payload = { ...ruleData, workspaceId };
    await coll.doc(id).set(payload, { merge: true });
    return { ...payload, id } as ClassificationRule;
  }

  const { workspaceId: _workspaceId, ...ruleData } = data;
  const payload = { ...ruleData, workspaceId } as Omit<ClassificationRule, 'id'>;
  const docRef = await coll.add(payload);
  return { ...payload, id: docRef.id };
};

export const deleteRule = async (
  workspaceId: string,
  ruleId: string
): Promise<void> => {
  await assertWorkspaceExists(workspaceId);
  await assertWorkspaceDocumentExists(workspaceId, 'rules', ruleId, 'Rule');
  await db.collection(rulesCollection(workspaceId)).doc(ruleId).delete();
};

export const applyRulesToTransaction = (
  tx: Partial<Transaction>,
  rules: ClassificationRule[]
): Partial<Transaction> => applyRules(tx, rules);

export { tokenizeDescription, descriptionSimilarity };

export const ruleMatchesTransactionForBackfill = (
  rule: ClassificationRule,
  tx: Transaction,
  similarityThreshold: number = 0.6
): boolean => {
  if (rule.workspaceId !== tx.workspaceId) return false;
  return ruleMatchesForBackfill(rule, tx, similarityThreshold);
};

export const applyRuleClassificationToTransaction = (
  tx: Transaction,
  rule: ClassificationRule,
  categories: (Category & { subcategories: Subcategory[] })[]
): Partial<Transaction> => {
  if (rule.workspaceId !== tx.workspaceId) {
    throw new Error('A classification rule cannot be applied across workspaces.');
  }
  return applyRuleClassification(tx, rule, categories);
};
