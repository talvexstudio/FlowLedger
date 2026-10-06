import { NextResponse } from 'next/server';
import {
  executeImportHistoryAction,
  listImportHistory,
} from '@/lib/data-management/import-history';
import { asRestoreError, type RestoreErrorCode } from '@/lib/data-management/restore-errors';

export const runtime = 'nodejs';

const statusForError = (code: RestoreErrorCode) => {
  if (code === 'ROLLBACK_FAILURE' || code === 'DATA_OPERATION_FAILURE') return 500;
  if (code === 'REFERENTIAL_INTEGRITY_FAILURE') return 409;
  return 400;
};

const errorResponse = (error: unknown) => {
  const operationError = asRestoreError(error);
  return NextResponse.json({
    ok: false,
    error: { code: operationError.code, message: operationError.message },
  }, { status: statusForError(operationError.code) });
};

export async function GET(request: Request) {
  try {
    const workspaceId = new URL(request.url).searchParams.get('workspaceId');
    const imports = await listImportHistory(workspaceId);
    return NextResponse.json({ ok: true, imports }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      workspaceId?: unknown;
      action?: unknown;
      importId?: unknown;
      confirmed?: unknown;
    };
    const result = await executeImportHistoryAction(
      body?.workspaceId,
      body?.action,
      body?.importId,
      body?.confirmed === true
    );
    return NextResponse.json({ ok: true, result }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
