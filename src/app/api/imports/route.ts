import { NextRequest, NextResponse } from 'next/server';
import {
  getImportSessions,
  saveImportSession,
  deleteImportSession,
  commitImport,
  ImportCommitError,
} from '@/lib/services/imports';

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get('workspaceId');
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });
  try {
    const sessions = await getImportSessions(workspaceId);
    return NextResponse.json(sessions);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { workspaceId, session, transactions, ...data } = body;
    if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });

    if (session || transactions) {
      if (!session || !Array.isArray(transactions)) {
        return NextResponse.json(
          { error: 'session and transactions are required for an import commit' },
          { status: 400 }
        );
      }
      const result = await commitImport(
        workspaceId,
        { ...session, workspaceId },
        transactions
      );
      return NextResponse.json(result);
    }

    const result = await saveImportSession(workspaceId, { ...data, workspaceId });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json(
      {
        error: e.message,
        rollbackComplete: e instanceof ImportCommitError ? e.rollbackComplete : undefined,
      },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { workspaceId, id } = body;
    if (!workspaceId || !id) return NextResponse.json({ error: 'workspaceId and id required' }, { status: 400 });
    await deleteImportSession(workspaceId, id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
