import { NextRequest, NextResponse } from 'next/server';
import {
  getTransactions,
  saveTransaction,
  createInternalTransferPair,
  confirmTransaction,
  deleteTransaction,
  deleteTransactions,
  deleteTransactionsByImport,
  getTransaction,
} from '@/lib/services/transactions';
import {
  findDuplicateTransactions,
  findPotentialTransfers,
  getDuplicateApprovalBlockReason,
  toPotentialDuplicateMatchContext,
} from '@/lib/utils/duplicate-utils';
import { getCategories } from '@/lib/services/categories';
import { isTransactionSufficientlyClassified } from '@/lib/import-processing';

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get('workspaceId');
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });
  try {
    const transactions = await getTransactions(workspaceId);
    return NextResponse.json(transactions);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { workspaceId, ...data } = body;
    if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });

    if (data.type === 'InternalTransfer' && data.destinationAccountId) {
      const { source } = await createInternalTransferPair(workspaceId, data);
      return NextResponse.json(source);
    }

    // Flag potential duplicates and transfers for new transactions (not edits)
    if (!data.id) {
      const existing = await getTransactions(workspaceId);
      const dupes = findDuplicateTransactions(data, existing);
      const transfers = findPotentialTransfers(data, existing);

      if (dupes.length > 0) {
        data.isPotentialDuplicate = true;
        data.potentialDuplicateMatch = toPotentialDuplicateMatchContext(dupes[0]);
        data.needsReview = true;
      }
      if (transfers.length > 0) {
        data.isPotentialTransfer = true;
        data.potentialTransferMatch = transfers[0]; // Store best match
        if (data.importId) data.needsReview = true;
      }
    }

    if (data.id && data.needsReview === false) {
      const current = await getTransaction(workspaceId, data.id);
      if (current?.needsReview) {
        const duplicateBlockReason = getDuplicateApprovalBlockReason(current, data);
        if (duplicateBlockReason) {
          return NextResponse.json(
            { error: duplicateBlockReason },
            { status: 409 }
          );
        }
        const categories = await getCategories();
        if (!isTransactionSufficientlyClassified({ ...current, ...data }, categories)) {
          return NextResponse.json(
            { error: 'Choose a valid category and subcategory before completing review.' },
            { status: 409 }
          );
        }
      }
    }

    const result = await saveTransaction(workspaceId, data);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, workspaceId, transactionId, ids, importId } = body;

    if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });

    if (action === 'confirm') {
      const transaction = await getTransaction(workspaceId, transactionId);
      if (!transaction) {
        return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
      }
      const duplicateBlockReason = getDuplicateApprovalBlockReason(transaction);
      if (duplicateBlockReason) {
        return NextResponse.json(
          { error: duplicateBlockReason },
          { status: 409 }
        );
      }
      const categories = await getCategories();
      if (!isTransactionSufficientlyClassified(transaction, categories)) {
        return NextResponse.json(
          { error: 'Choose a valid category and subcategory before approving this transaction.' },
          { status: 409 }
        );
      }
      await confirmTransaction(workspaceId, transactionId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { workspaceId, id, ids, importId } = body;

    if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });

    if (importId) {
      await deleteTransactionsByImport(workspaceId, importId);
    } else if (ids && Array.isArray(ids)) {
      await deleteTransactions(workspaceId, ids);
    } else if (id) {
      await deleteTransaction(workspaceId, id);
    } else {
      return NextResponse.json({ error: 'Provide id, ids, or importId' }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
