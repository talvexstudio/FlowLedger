import { NextResponse } from 'next/server';
import { asRestoreError } from '@/lib/data-management/restore-errors';
import { restoreBackup } from '@/lib/data-management/restore';
import { readRestoreUpload } from '@/lib/data-management/restore-upload';

export const runtime = 'nodejs';

const statusForCode = (code: string) =>
  code === 'RESTORE_EXECUTION_FAILURE' || code === 'ROLLBACK_FAILURE' ? 500 : 400;

export async function POST(request: Request) {
  try {
    const upload = await readRestoreUpload(request);
    if (upload.formData.get('confirmReplaceAll') !== 'true') {
      return NextResponse.json({
        ok: false,
        error: { code: 'INVALID_BACKUP', message: 'Explicit replace-all confirmation is required.' },
      }, { status: 400 });
    }

    const recreateMissingWorkspace = upload.formData.get('recreateMissingWorkspace') === 'true';
    const recreatedWorkspaceNameValue = upload.formData.get('recreatedWorkspaceName');
    const recreatedWorkspaceName = typeof recreatedWorkspaceNameValue === 'string'
      ? recreatedWorkspaceNameValue
      : undefined;
    const result = await restoreBackup(upload.json, {
      recreateMissingWorkspace,
      recreatedWorkspaceName,
    });
    return NextResponse.json({ ok: true, result }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const restoreError = asRestoreError(error);
    return NextResponse.json({
      ok: false,
      error: { code: restoreError.code, message: restoreError.message },
    }, { status: statusForCode(restoreError.code) });
  }
}
