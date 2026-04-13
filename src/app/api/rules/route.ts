import { NextRequest, NextResponse } from 'next/server';
import { getRules, saveRule, deleteRule } from '@/lib/services/rules';

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get('workspaceId');
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });
  try {
    const rules = await getRules(workspaceId);
    return NextResponse.json(rules);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { workspaceId, ...data } = body;
    if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });
    const result = await saveRule(workspaceId, { ...data, workspaceId });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { workspaceId, id } = body;
    if (!workspaceId || !id) return NextResponse.json({ error: 'workspaceId and id required' }, { status: 400 });
    await deleteRule(workspaceId, id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
