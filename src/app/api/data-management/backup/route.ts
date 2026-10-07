import { NextResponse } from 'next/server';
import {
  BackupExportError,
  createBackup,
  createBackupFilename,
} from '@/lib/data-management/backup';
import { isBackupScope } from '@/lib/data-management/store-manifest';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });
  }

  const scope = typeof body === 'object' && body !== null && 'scope' in body
    ? (body as { scope?: unknown }).scope
    : undefined;
  const workspaceId = typeof body === 'object' && body !== null && 'workspaceId' in body &&
    typeof (body as { workspaceId?: unknown }).workspaceId === 'string'
    ? (body as { workspaceId: string }).workspaceId
    : undefined;
  if (!isBackupScope(scope)) {
    return NextResponse.json({ error: 'Unsupported backup scope.' }, { status: 400 });
  }
  if (scope !== 'everything' && !workspaceId) {
    return NextResponse.json({ error: 'Select a workspace before exporting this backup scope.' }, { status: 400 });
  }

  try {
    const backup = await createBackup(scope, { workspaceId });
    const filename = createBackupFilename(backup.createdAt, scope);
    return new NextResponse(JSON.stringify(backup, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof BackupExportError
      ? error.message
      : 'Backup export failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
