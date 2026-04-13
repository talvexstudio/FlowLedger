import { z } from 'zod';

export const transactionSchema = z.object({
  id: z.string().optional(),
  accountId: z.string().min(1, "Account is required."),
  date: z.date({ required_error: "Please select a date." }),
  description: z.string().min(1, 'Description is required.'),
  amountBase: z.number({ required_error: "Amount is required."}).min(-100000000, "Amount is too low").max(100000000, "Amount is too high"),
  type: z.enum(['Expense', 'Income', 'InternalTransfer', 'Adjustment']),
  internalDirection: z.enum(['Out', 'In']).optional(),
  destinationAccountId: z.string().optional(),
  categoryId: z.string().optional(),
  subcategoryId: z.string().optional(),
  createRule: z.boolean().default(false),
});

export type TransactionFormValues = z.infer<typeof transactionSchema>;

export const accountSchema = z.object({
  name: z.string().min(1, "Account name is required."),
  type: z.enum(['bank', 'credit_card', 'fintech', 'cash', 'investment', 'other']),
  currency: z.string().length(3, "Currency must be a 3-letter code."),
  institution: z.string().min(1, "Institution is required."),
  openingBalance: z.number().default(0),
});

export const workspaceSchema = z.object({
    name: z.string().min(1, 'Workspace name is required.'),
});
