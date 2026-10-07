import { NextRequest, NextResponse } from 'next/server';
import { deleteCategory, getCategories, saveCategory, saveSubcategory } from '@/lib/services/categories';

const isCategoryPayload = (value: any) =>
  value &&
  typeof value === 'object' &&
  (value.id === undefined || typeof value.id === 'string') &&
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

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get('workspaceId');
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });
  try {
    const categories = await getCategories(workspaceId);
    return NextResponse.json(categories);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { workspaceId } = body;
    if (typeof workspaceId !== 'string' || !workspaceId) {
      return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });
    }

    if (body?.entity === 'subcategory') {
      const { categoryId, data } = body;
      if (!categoryId || !isSubcategoryPayload(data)) {
        return NextResponse.json({ error: 'Valid categoryId and subcategory data required' }, { status: 400 });
      }
      const result = await saveSubcategory(workspaceId, categoryId, { ...data, categoryId });
      return NextResponse.json(result);
    }

    if (body?.entity === 'category') {
      if (!isCategoryPayload(body.data)) {
        return NextResponse.json({ error: 'Valid category data required' }, { status: 400 });
      }
      const result = await saveCategory(workspaceId, body.data);
      return NextResponse.json(result);
    }

    // Backward compatibility for clients compiled against the former payload shape.
    if (body?.type === 'subcategory') {
      const { type: _entityType, categoryId, workspaceId: _workspaceId, ...data } = body;
      if (!categoryId || !isSubcategoryPayload(data)) {
        return NextResponse.json({ error: 'Valid categoryId and subcategory data required' }, { status: 400 });
      }
      const result = await saveSubcategory(workspaceId, categoryId, { ...data, categoryId });
      return NextResponse.json(result);
    }

    if (!isCategoryPayload(body)) {
      return NextResponse.json({ error: 'Valid category data required' }, { status: 400 });
    }
    const result = await saveCategory(workspaceId, body);
    return NextResponse.json(result);
  } catch (e: any) {
    console.error('POST /api/categories failed', e);
    if (String(e?.message).includes('not found in the selected workspace')) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { workspaceId, categoryId } = await req.json();
    if (!workspaceId || !categoryId) {
      return NextResponse.json({ error: 'workspaceId and categoryId required' }, { status: 400 });
    }
    await deleteCategory(workspaceId, categoryId);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const status = String(e?.message).includes('not found in the selected workspace') ? 404 : 409;
    return NextResponse.json({ error: e?.message ?? 'Category deletion failed' }, { status });
  }
}
