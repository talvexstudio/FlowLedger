import { NextRequest, NextResponse } from 'next/server';
import { getAccounts, saveAccount, archiveAccount, deleteAccount } from '@/lib/services/accounts';

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get('workspaceId');
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });
  try {
    const accounts = await getAccounts(workspaceId);
    return NextResponse.json(accounts);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { workspaceId, ...data } = body;
    if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });
    const result = await saveAccount(workspaceId, { ...data, workspaceId });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { workspaceId, id, action } = body;
    if (!workspaceId || !id) return NextResponse.json({ error: 'workspaceId and id required' }, { status: 400 });

    if (action === 'archive') {
      await archiveAccount(workspaceId, id);
    } else {
      await deleteAccount(workspaceId, id);
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
