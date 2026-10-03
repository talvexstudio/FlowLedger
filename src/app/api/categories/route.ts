import { NextRequest, NextResponse } from 'next/server';
import { getCategories, saveCategory, saveSubcategory } from '@/lib/services/categories';

const isCategoryPayload = (value: any) =>
  value &&
  typeof value === 'object' &&
  typeof value.id === 'string' &&
  typeof value.name === 'string' &&
  ['expense', 'income', 'both'].includes(value.type) &&
  typeof value.order === 'number' &&
  typeof value.isSystem === 'boolean';

const isSubcategoryPayload = (value: any) =>
  value &&
  typeof value === 'object' &&
  typeof value.id === 'string' &&
  typeof value.name === 'string' &&
  typeof value.order === 'number' &&
  typeof value.isSystem === 'boolean';

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

    if (body?.entity === 'subcategory') {
      const { categoryId, data } = body;
      if (!categoryId || !isSubcategoryPayload(data)) {
        return NextResponse.json({ error: 'Valid categoryId and subcategory data required' }, { status: 400 });
      }
      const result = await saveSubcategory(categoryId, { ...data, categoryId });
      return NextResponse.json(result);
    }

    if (body?.entity === 'category') {
      if (!isCategoryPayload(body.data)) {
        return NextResponse.json({ error: 'Valid category data required' }, { status: 400 });
      }
      const result = await saveCategory(body.data);
      return NextResponse.json(result);
    }

    // Backward compatibility for clients compiled against the former payload shape.
    if (body?.type === 'subcategory') {
      const { type: _entityType, categoryId, ...data } = body;
      if (!categoryId || !isSubcategoryPayload(data)) {
        return NextResponse.json({ error: 'Valid categoryId and subcategory data required' }, { status: 400 });
      }
      const result = await saveSubcategory(categoryId, { ...data, categoryId });
      return NextResponse.json(result);
    }

    if (!isCategoryPayload(body)) {
      return NextResponse.json({ error: 'Valid category data required' }, { status: 400 });
    }
    const result = await saveCategory(body);
    return NextResponse.json(result);
  } catch (e: any) {
    console.error('POST /api/categories failed', e);
    if (e?.message === 'Category not found.') {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
