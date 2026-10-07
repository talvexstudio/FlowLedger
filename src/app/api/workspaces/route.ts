import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaces } from '@/lib/services/workspaces';
import {
  createWorkspace,
  renameWorkspace,
  WorkspaceLifecycleError,
} from '@/lib/data-management/workspace-lifecycle';
import { RestoreError } from '@/lib/data-management/restore-errors';
import type {
  CreateWorkspaceInput,
  RenameWorkspaceInput,
} from '@/lib/workspace-lifecycle-types';

const LOCAL_USER_ID = 'local';

export async function GET() {
  try {
    const workspaces = await getWorkspaces(LOCAL_USER_ID);
    return NextResponse.json(workspaces);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as CreateWorkspaceInput;
    const result = await createWorkspace(body, LOCAL_USER_ID);
    return NextResponse.json(result);
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as RenameWorkspaceInput;
    const result = await renameWorkspace(body, LOCAL_USER_ID);
    return NextResponse.json(result);
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

const workspaceErrorResponse = (error: unknown) => {
  if (error instanceof WorkspaceLifecycleError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof RestoreError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'Workspace operation failed.' },
    { status: 500 }
  );
};
