import { db } from "./firestore";
import type { Category, ClassificationRule, Subcategory, Transaction } from "../types";
import { getAccounts } from './accounts';
import { getCategories } from './categories';
import { assertWorkspaceDocumentExists, assertWorkspaceExists } from './workspace-integrity';
import { describeRuleValidity, validateRuleAction } from '../rule-validity';
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
  const [accounts, categories] = await Promise.all([
    getAccounts(workspaceId),
    getCategories(workspaceId),
  ]);
  const validity = validateRuleAction(data, { workspaceId, accounts, categories });
  if (!validity.valid) throw new Error(describeRuleValidity(validity));
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
