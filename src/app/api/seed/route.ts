import { NextRequest, NextResponse } from 'next/server';
import { seedDemoData } from '@/lib/data-management/demo-data';
import { RestoreError } from '@/lib/data-management/restore-errors';

export async function POST(req: NextRequest) {
  try {
    const { workspaceId, clear } = await req.json() as {
      workspaceId?: string;
      clear?: boolean;
    };
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });
    }

    return NextResponse.json(await seedDemoData(workspaceId, clear === true));
  } catch (error) {
    if (error instanceof RestoreError) {
      const status = error.code === 'INVALID_OPERATION' ? 404 : 500;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Demo data could not be loaded.' },
      { status: 500 }
    );
  }
}
