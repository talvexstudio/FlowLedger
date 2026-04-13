import { NextRequest, NextResponse } from 'next/server';
import { getCategories, saveCategory, saveSubcategory } from '@/lib/services/categories';

export async function GET() {
  try {
    const categories = await getCategories();
    return NextResponse.json(categories);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, categoryId, ...data } = body;

    if (type === 'subcategory') {
      if (!categoryId) return NextResponse.json({ error: 'categoryId required' }, { status: 400 });
      const result = await saveSubcategory(categoryId, data);
      return NextResponse.json(result);
    }

    const result = await saveCategory(data);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
