import { NextRequest, NextResponse } from 'next/server';
import {
  applyBudgetSuggestions,
  BudgetSuggestionApplyError,
  type BudgetSuggestionApplyInput,
} from '@/lib/data-management/budget-suggestion-apply';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as BudgetSuggestionApplyInput;
    return NextResponse.json(await applyBudgetSuggestions({
      workspaceId: body.workspaceId,
      targetYear: Number(body.targetYear),
      targetMonth: Number(body.targetMonth),
      entries: Array.isArray(body.entries)
        ? body.entries.map((entry) => ({ categoryId: entry.categoryId, amount: Number(entry.amount) }))
        : [],
    }));
  } catch (error) {
    const status = error instanceof BudgetSuggestionApplyError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Applying suggested budgets failed.';
    return NextResponse.json({ error: message }, { status });
  }
}
