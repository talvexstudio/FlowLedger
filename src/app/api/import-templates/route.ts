import { NextRequest, NextResponse } from 'next/server';
import {
  getImportTemplates,
  saveImportTemplate,
  findMatchingTemplate,
} from '@/lib/services/imports';

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get('workspaceId');
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });

  const headers = req.nextUrl.searchParams.get('headers');
  try {
    if (headers) {
      const headerSignature = JSON.parse(headers) as string[];
      const match = await findMatchingTemplate(workspaceId, headerSignature);
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
