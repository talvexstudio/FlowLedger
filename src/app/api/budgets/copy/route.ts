import { NextRequest, NextResponse } from 'next/server';
import {
  BudgetCopyError,
  copyBudgets,
  listBudgetCopySources,
  previewBudgetCopy,
  type BudgetCopyInput,
} from '@/lib/data-management/budget-copy';

const responseForError = (error: unknown) => {
  const status = error instanceof BudgetCopyError ? error.status : 500;
  const message = error instanceof Error ? error.message : 'Budget copy failed.';
  return NextResponse.json({ error: message }, { status });
};

export async function GET(req: NextRequest) {
  try {
    const workspaceId = req.nextUrl.searchParams.get('workspaceId');
    if (!workspaceId) throw new BudgetCopyError('Workspace ID is required.');
    return NextResponse.json({ sources: await listBudgetCopySources(workspaceId) });
  } catch (error) {
    return responseForError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as BudgetCopyInput & { previewOnly?: boolean };
    const input: BudgetCopyInput = {
      workspaceId: body.workspaceId,
      sourceYear: Number(body.sourceYear),
      sourceMonth: Number(body.sourceMonth),
      targetYear: Number(body.targetYear),
      targetMonth: Number(body.targetMonth),
      mode: body.mode,
    };
    return NextResponse.json(body.previewOnly
      ? await previewBudgetCopy(input)
      : await copyBudgets(input));
  } catch (error) {
    return responseForError(error);
  }
}
