import { NextResponse } from 'next/server';
import { previewImportHistoryAction } from '@/lib/data-management/import-history';
import { asRestoreError, type RestoreErrorCode } from '@/lib/data-management/restore-errors';

export const runtime = 'nodejs';

const statusForError = (code: RestoreErrorCode) => {
  if (code === 'ROLLBACK_FAILURE' || code === 'DATA_OPERATION_FAILURE') return 500;
  if (code === 'REFERENTIAL_INTEGRITY_FAILURE') return 409;
  return 400;
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      workspaceId?: unknown;
      action?: unknown;
      importId?: unknown;
    };
    const preview = await previewImportHistoryAction(
      body?.workspaceId,
      body?.action,
      body?.importId
    );
    return NextResponse.json({ ok: true, preview }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const operationError = asRestoreError(error);
    return NextResponse.json({
      ok: false,
      error: { code: operationError.code, message: operationError.message },
    }, { status: statusForError(operationError.code) });
  }
}
