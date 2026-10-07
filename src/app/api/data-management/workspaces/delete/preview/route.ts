import { NextResponse } from 'next/server';
import {
  previewWorkspaceDeletion,
  WorkspaceDeletionError,
} from '@/lib/data-management/workspace-deletion';
import { RestoreError } from '@/lib/data-management/restore-errors';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { workspaceId?: unknown };
    const preview = await previewWorkspaceDeletion(body?.workspaceId);
    return NextResponse.json({ ok: true, preview }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return workspaceDeletionErrorResponse(error);
  }
}

const workspaceDeletionErrorResponse = (error: unknown) => {
  if (error instanceof WorkspaceDeletionError) {
    return NextResponse.json({
      ok: false,
      error: { code: error.code, message: error.message },
    }, { status: error.status });
  }
  if (error instanceof RestoreError) {
    return NextResponse.json({
      ok: false,
      error: { code: error.code, message: error.message },
    }, { status: error.code === 'ROLLBACK_FAILURE' || error.code === 'DATA_OPERATION_FAILURE' ? 500 : 400 });
  }
  return NextResponse.json({
    ok: false,
    error: { code: 'INVALID_REQUEST', message: 'Workspace deletion preview failed.' },
  }, { status: 400 });
};
