import { NextResponse } from 'next/server';
import { listSupportedPdfTemplates } from '@/lib/server/pdf-extraction';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(listSupportedPdfTemplates());
}
