import { NextRequest, NextResponse } from 'next/server';
import { getBudget, saveBudgetLine, deleteBudgetLine } from '@/lib/services/budgets';

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get('workspaceId');
  const year = req.nextUrl.searchParams.get('year');
  if (!workspaceId || !year) {
    return NextResponse.json({ error: 'workspaceId and year required' }, { status: 400 });
  }
  try {
    const result = await getBudget(workspaceId, Number(year));
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { workspaceId, year, line } = body;
    if (!workspaceId || !year || !line) {
      return NextResponse.json({ error: 'workspaceId, year and line required' }, { status: 400 });
    }
    const result = await saveBudgetLine(workspaceId, Number(year), line);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { workspaceId, year, categoryId } = body;
    if (!workspaceId || !year || !categoryId) {
      return NextResponse.json({ error: 'workspaceId, year and categoryId required' }, { status: 400 });
    }
    await deleteBudgetLine(workspaceId, Number(year), categoryId);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
