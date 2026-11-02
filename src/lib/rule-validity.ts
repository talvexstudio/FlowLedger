import type { Account, ClassificationRule } from './types';
import type { RuntimeCategory } from './category-ownership';

export type RuleValidityIssueCode =
  | 'unsupported-match-mode'
  | 'missing-source-account'
  | 'invalid-source-account'
  | 'missing-transfer-direction'
  | 'missing-destination-account'
  | 'same-account-destination'
  | 'invalid-destination-account'
  | 'transfer-category-action'
  | 'subcategory-without-category'
  | 'invalid-category'
  | 'invalid-subcategory';

export type RuleValidityIssue = {
  code: RuleValidityIssueCode;
  message: string;
};

export type RuleValidityResult = {
  valid: boolean;
  issues: RuleValidityIssue[];
  missingFields: Array<'match.accountId' | 'action.internalDirection' | 'action.destinationAccountId'>;
};

export type RuleValidityContext = {
  workspaceId?: string;
  accounts?: Pick<Account, 'id' | 'workspaceId'>[];
  categories?: RuntimeCategory[];
};

export const INVALID_RULE_LABEL = 'Invalid rule';

const issue = (code: RuleValidityIssueCode, message: string): RuleValidityIssue => ({ code, message });

export const validateRuleAction = (
  rule: ClassificationRule | Omit<ClassificationRule, 'id'>,
  context: RuleValidityContext = {}
): RuleValidityResult => {
  const issues: RuleValidityIssue[] = [];
  const missingFields: RuleValidityResult['missingFields'] = [];
  const workspaceId = context.workspaceId ?? rule.workspaceId;
  const sourceAccountId = rule.match?.accountId;
  const action = rule.action ?? {};

  if (rule.match?.matchMode && !['contains', 'starts_with'].includes(rule.match.matchMode)) {
    issues.push(issue('unsupported-match-mode', 'Unsupported description match mode.'));
  }

  if (sourceAccountId && context.accounts) {
    const source = context.accounts.find((account) => account.id === sourceAccountId);
    if (!source || source.workspaceId !== workspaceId) {
      issues.push(issue('invalid-source-account', 'Source account does not belong to the selected workspace.'));
    }
  }

  if (action.type === 'InternalTransfer') {
    if (!sourceAccountId) {
      missingFields.push('match.accountId');
      issues.push(issue('missing-source-account', 'Missing source account.'));
    }
    if (action.internalDirection !== 'In' && action.internalDirection !== 'Out') {
      missingFields.push('action.internalDirection');
      issues.push(issue(
        'missing-transfer-direction',
        'Missing transfer direction. Choose whether matching transfers are entering or leaving this account.'
      ));
    }
    if (!action.destinationAccountId) {
      missingFields.push('action.destinationAccountId');
      issues.push(issue(
        'missing-destination-account',
        'Missing destination account. Choose a counterpart account for matching transfers.'
      ));
    } else {
      if (action.destinationAccountId === sourceAccountId) {
        issues.push(issue(
          'same-account-destination',
          'Destination account must be different from the source account.'
        ));
      }
      if (context.accounts) {
        const destination = context.accounts.find(
          (account) => account.id === action.destinationAccountId
        );
        if (!destination || destination.workspaceId !== workspaceId) {
          issues.push(issue(
            'invalid-destination-account',
            'Destination account does not belong to the selected workspace.'
          ));
        }
      }
    }
    if (action.categoryId || action.subcategoryId) {
      issues.push(issue(
        'transfer-category-action',
        'Internal transfer rules cannot assign a category or subcategory.'
      ));
    }
  } else {
    if (!action.categoryId && action.subcategoryId) {
      issues.push(issue('subcategory-without-category', 'A subcategory requires a category.'));
    }
    if (action.categoryId && context.categories) {
      const category = context.categories.find((candidate) =>
        candidate.id === action.categoryId && candidate.workspaceId === workspaceId
      );
      if (!category) {
        issues.push(issue('invalid-category', 'Category not found in the selected workspace.'));
      } else if (action.subcategoryId) {
        const subcategory = category.subcategories.find((candidate) =>
          candidate.id === action.subcategoryId &&
          candidate.categoryId === category.id &&
          candidate.workspaceId === workspaceId
        );
        if (!subcategory) {
          issues.push(issue(
            'invalid-subcategory',
            'Subcategory does not belong to the selected category and workspace.'
          ));
        }
      }
    }
  }

  return { valid: issues.length === 0, issues, missingFields };
};

export const describeRuleValidity = (result: RuleValidityResult): string => {
  const missingDirection = result.issues.some((entry) => entry.code === 'missing-transfer-direction');
  const missingDestination = result.issues.some((entry) => entry.code === 'missing-destination-account');
  const otherIssues = result.issues.filter((entry) =>
    entry.code !== 'missing-transfer-direction' && entry.code !== 'missing-destination-account'
  );
  const messages: string[] = [];
  if (missingDirection && missingDestination) {
    messages.push(
      'Missing transfer direction and destination account. Choose whether matching transfers are entering or leaving this account and choose a counterpart account.'
    );
  } else if (missingDirection) {
    messages.push(
      'Missing transfer direction. Choose whether matching transfers are entering or leaving this account.'
    );
  } else if (missingDestination) {
    messages.push('Missing destination account. Choose a counterpart account for matching transfers.');
  }
  messages.push(...otherIssues.map((entry) => entry.message));
  return messages.join(' ');
};

export const getActionableRules = (
  rules: ClassificationRule[],
  context: RuleValidityContext = {}
) => rules.filter((rule) => validateRuleAction(rule, context).valid);
