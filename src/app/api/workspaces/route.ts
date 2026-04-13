import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaces, saveWorkspace } from '@/lib/services/workspaces';

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
    const body = await req.json();
    const result = await saveWorkspace({ ...body, ownerUserId: LOCAL_USER_ID });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
