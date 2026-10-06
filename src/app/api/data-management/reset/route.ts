import { NextResponse } from 'next/server';
import { executeDataReset } from '@/lib/data-management/data-reset';
import { asRestoreError } from '@/lib/data-management/restore-errors';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { operation?: unknown; confirmed?: unknown };
    const result = await executeDataReset(body?.operation, body?.confirmed === true);
    return NextResponse.json({ ok: true, result }, {
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
