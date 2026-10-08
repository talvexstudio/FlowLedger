import { NextRequest, NextResponse } from 'next/server';
import {
  getImportTemplates,
  saveImportTemplate,
  findMatchingTemplate,
} from '@/lib/services/imports';
import type { ImportTemplate } from '@/lib/types';

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get('workspaceId');
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });

  const headers = req.nextUrl.searchParams.get('headers');
  const sourceType = req.nextUrl.searchParams.get('sourceType');
  try {
    if (headers) {
      const headerSignature = JSON.parse(headers) as string[];
      if (sourceType && sourceType !== 'CSV' && sourceType !== 'XLSX') {
        return NextResponse.json({ error: 'sourceType must be CSV or XLSX' }, { status: 400 });
      }
      const match = await findMatchingTemplate(
        workspaceId,
        headerSignature,
        sourceType as ImportTemplate['sourceType'] | undefined
      );
      return NextResponse.json(match);
    }
    const templates = await getImportTemplates(workspaceId);
    return NextResponse.json(templates);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { workspaceId, ...data } = body;
    if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });
    const result = await saveImportTemplate(workspaceId, data);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
