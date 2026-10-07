import { NextResponse } from 'next/server';
import { previewDataReset } from '@/lib/data-management/data-reset';
import { asRestoreError } from '@/lib/data-management/restore-errors';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { operation?: unknown; workspaceId?: unknown };
    const workspaceId = typeof body?.workspaceId === 'string' ? body.workspaceId : undefined;
    const preview = await previewDataReset(body?.operation, { workspaceId });
    return NextResponse.json({ ok: true, preview }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const operationError = asRestoreError(error);
    return NextResponse.json({
      ok: false,
      error: { code: operationError.code, message: operationError.message },
    }, { status: operationError.code === 'ROLLBACK_FAILURE' || operationError.code === 'DATA_OPERATION_FAILURE' ? 500 : 400 });
  }
}
