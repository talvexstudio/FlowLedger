export type User = {
    uid: string;
    email: string | null;
    displayName: string | null;
    photoURL: string | null;
}

export type Workspace = {
  id: string;
  ownerUserId: string;
  name: string;
  baseCurrency: string;
  createdAt: Date;
  updatedAt: Date;
};

export type Account = {
  id: string;
  workspaceId: string;
  name: string;
  type: 'bank' | 'credit_card' | 'fintech' | 'cash' | 'investment' | 'other';
  currency: string;
  institution: string;
  openingBalance: number;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type PotentialDuplicateMatchContext = {
  transactionId: string;
  date: Date;
  description: string;
  amountBase: number;
};

export type Transaction = {
  id: string;
  workspaceId: string;
  accountId: string;
  date: Date;
  valueDate?: Date;
  description: string;
  rawDescription: string;
  amountOriginal: number;
  currencyOriginal: string;
  amountBase: number;
  exchangeRate?: number;
  balanceAfter?: number;
  type: 'Expense' | 'Income' | 'InternalTransfer' | 'Adjustment';
  categoryId?: string;
  subcategoryId?: string;
  importId?: string;
  needsReview: boolean;
  isInternalTransfer: boolean;
  internalDirection?: 'Out' | 'In';
  destinationAccountId?: string;
  linkedTransactionId?: string;
  isPotentialDuplicate: boolean;
  potentialDuplicateMatch?: PotentialDuplicateMatchContext | null;
  isPotentialTransfer?: boolean;
  potentialTransferMatch?: any; // DuplicateMatch from duplicate-utils
  isInconsistent: boolean;
  sourceFileId?: string;
  sourceAccountName?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ImportSession = {
  id: string;
  workspaceId: string;
  accountId: string;
  createdAt: Date;
  fileName: string;
  sourceType: "CSV" | "XLSX";
  template: string;
  transactionCount: number;
};

export type Category = {
  id: string;
  workspaceId?: string | null;
  name: string;
  type: 'expense' | 'income' | 'both';
  order: number;
  isSystem: boolean;
  isActive?: boolean;
  isCustom?: boolean;
};

export type Subcategory = {
  id:string;
  workspaceId?: string | null;
  categoryId: string;
  name: string;
  order: number;
  isSystem: boolean;
  isActive?: boolean;
  isCustom?: boolean;
  flowType?: "Expense" | "Income";
};

export type ClassificationRule = {
  id: string;
  workspaceId: string;
  match: {
    descriptionContains?: string;
    accountId?: string;
    minAmount?: number;
    maxAmount?: number;
  };
  action: {
    categoryId?: string;
    subcategoryId?: string;
    type?: Transaction["type"];
  };
  createdFromTransactionId?: string;
  createdAt: Date;
};

export type ImportTemplate = {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  sourceType: "CSV" | "XLSX";
  headerSignature: string[];
  mapping: {
    dateField: string;
    descriptionField: string;
    rawDescriptionField?: string;
    debitField?: string;
    creditField?: string;
    amountField?: string;
    balanceField?: string;
    dateFormat?: string;
    amountOptions?: {
      decimalSeparator?: "," | ".";
      thousandsSeparator?: "," | "." | " ";
    };
  };
  defaultAccountId?: string;
  createdAt: Date;
};

export type Budget = {
  id: string;
  workspaceId: string;
  year: number;
  createdFromSampleMonths: number;
  samplePeriodFrom: string; // "YYYY-MM"
  samplePeriodTo: string; // "YYYY-MM"
  createdAt: Date;
};

export type BudgetLine = {
  id: string;
  budgetId: string;
  type: 'Expense' | 'Income';
  categoryId: string;
  subcategoryId: string;
  totalSample: number;
  monthlyAverage: number;
  annualBudget: number;
  percentageOfType: number;
  userAdjustedMonthly?: number;
  userAdjustedAnnual?: number;
};
