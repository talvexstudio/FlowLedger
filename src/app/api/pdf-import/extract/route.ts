import { NextRequest, NextResponse } from 'next/server';
import { extractPdfStatement, PdfExtractionError } from '@/lib/server/pdf-extraction';

export const runtime = 'nodejs';

const errorStatus = (error: PdfExtractionError) => {
  switch (error.code) {
    case 'INVALID_FILE':
    case 'UNSUPPORTED_TEMPLATE':
      return 400;
    case 'PROCESS_TIMEOUT':
      return 504;
    case 'PYTHON_UNAVAILABLE':
    case 'DEPENDENCY_MISSING':
      return 503;
    case 'NO_SELECTABLE_TEXT':
    case 'TEMPLATE_MISMATCH':
    case 'LEDGER_NOT_FOUND':
    case 'NO_TRANSACTIONS':
    case 'INVALID_ENGINE_RESPONSE':
    case 'EXTRACTION_FAILED':
      return 422;
  }
};

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const templateId = form.get('templateId');
    const file = form.get('file');
    if (typeof templateId !== 'string' || !templateId) {
      return NextResponse.json({ error: 'templateId is required.' }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'A PDF file is required.' }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith('.pdf') || (file.type && file.type !== 'application/pdf')) {
      return NextResponse.json({ error: 'Only PDF files are supported.' }, { status: 400 });
    }

    const report = await extractPdfStatement(
      new Uint8Array(await file.arrayBuffer()),
      file.name,
      templateId
    );
    return NextResponse.json(report);
  } catch (error) {
    if (error instanceof PdfExtractionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: errorStatus(error) });
    }
    const message = error instanceof Error ? error.message : 'PDF extraction failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
