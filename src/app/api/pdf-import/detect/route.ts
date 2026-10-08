import { NextRequest, NextResponse } from 'next/server';
import { detectPdfStatement, PdfExtractionError } from '@/lib/server/pdf-extraction';

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
    default:
      return 422;
  }
};

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'A PDF file is required.' }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith('.pdf') || (file.type && file.type !== 'application/pdf')) {
      return NextResponse.json({ error: 'Only PDF files are supported.' }, { status: 400 });
    }

    return NextResponse.json(await detectPdfStatement(new Uint8Array(await file.arrayBuffer())));
  } catch (error) {
    if (error instanceof PdfExtractionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: errorStatus(error) });
    }
    return NextResponse.json({ error: 'PDF detection failed.' }, { status: 500 });
  }
}
