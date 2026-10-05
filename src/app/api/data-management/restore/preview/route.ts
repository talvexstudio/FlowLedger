import { NextResponse } from 'next/server';
import { asRestoreError } from '@/lib/data-management/restore-errors';
import { previewRestore } from '@/lib/data-management/restore';
import { readRestoreUpload } from '@/lib/data-management/restore-upload';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const upload = await readRestoreUpload(request);
    const preview = await previewRestore(upload.json);
    return NextResponse.json({ ok: true, preview }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const restoreError = asRestoreError(error);
    return NextResponse.json({
      ok: false,
      error: { code: restoreError.code, message: restoreError.message },
    }, { status: restoreError.code === 'ROLLBACK_FAILURE' ? 500 : 400 });
  }
}
