import { NextRequest, NextResponse } from 'next/server';
import {
  getTransactions,
  saveTransaction,
  createInternalTransferPair,
  confirmTransaction,
  deleteTransaction,
  deleteTransactionsByImport,
  getTransaction,
  findTransferCounterpartCandidates,
  linkExistingTransferPair,
  createCounterpartForExisting,
  TransferCandidatesExistError,
  TransferResolutionError,
} from '@/lib/services/transactions';
import {
  findDuplicateTransactions,
  findPotentialTransfers,
  getDuplicateApprovalBlockReason,
  toPotentialDuplicateMatchContext,
} from '@/lib/utils/duplicate-utils';
import { getCategories } from '@/lib/services/categories';
import { getAccounts } from '@/lib/services/accounts';
import { isTransactionSufficientlyClassified } from '@/lib/import-processing';
import {
  normalizeTransactionTypeFields,
  shouldCreateInternalTransferPair,
  validateInternalTransfer,
} from '@/lib/internal-transfer';

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get('workspaceId');
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });
  try {
    if (req.nextUrl.searchParams.get('action') === 'transferCandidates') {
      const transactionId = req.nextUrl.searchParams.get('transactionId');
      if (!transactionId) {
        return NextResponse.json({ error: 'transactionId required' }, { status: 400 });
      }
      const candidates = await findTransferCounterpartCandidates(workspaceId, transactionId);
      return NextResponse.json(candidates);
    }
    const transactions = await getTransactions(workspaceId);
    return NextResponse.json(transactions);
  } catch (e: unknown) {
    const status = e instanceof TransferResolutionError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Request failed' }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { workspaceId, ...data } = body;
    if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });

    const current = data.id ? await getTransaction(workspaceId, data.id) : null;
    if (data.id && !current) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    const candidate = normalizeTransactionTypeFields({
      ...current,
      ...data,
      workspaceId,
    });

    if (current?.linkedTransactionId) {
      if (candidate.type !== 'InternalTransfer') {
        return NextResponse.json(
          { error: 'A linked transfer pair cannot be converted to another transaction type.' },
          { status: 409 }
        );
      }
      const linked = await getTransaction(workspaceId, current.linkedTransactionId);
      if (!linked) {
        return NextResponse.json(
          { error: 'The linked transfer record could not be found.' },
          { status: 409 }
        );
      }
      if (candidate.destinationAccountId !== linked.accountId) {
        return NextResponse.json(
          { error: 'The counterpart account of a linked transfer pair cannot be changed.' },
          { status: 409 }
        );
      }
    }

    let accounts = [] as Awaited<ReturnType<typeof getAccounts>>;
    if (candidate.type === 'InternalTransfer') {
      accounts = await getAccounts(workspaceId);
      const validation = validateInternalTransfer(candidate, accounts, workspaceId);
      if (!validation.valid) {
        const invalidCounterpart = !!candidate.destinationAccountId && (
          candidate.destinationAccountId === candidate.accountId ||
          !accounts.some((account) =>
            account.id === candidate.destinationAccountId && account.workspaceId === workspaceId
          )
        );
        if (invalidCounterpart) {
          return NextResponse.json({ error: validation.reason }, { status: 400 });
        }
        candidate.needsReview = true;
      }

      if (shouldCreateInternalTransferPair(candidate) && validation.valid) {
        const { source } = await createInternalTransferPair(workspaceId, candidate);
        return NextResponse.json(source);
      }
    }

    // Flag potential duplicates and transfers for new transactions (not edits)
    if (!candidate.id) {
      const existing = await getTransactions(workspaceId);
      const dupes = findDuplicateTransactions(candidate, existing);
      const transfers = findPotentialTransfers(candidate, existing);

      if (dupes.length > 0) {
        candidate.isPotentialDuplicate = true;
        candidate.potentialDuplicateMatch = toPotentialDuplicateMatchContext(dupes[0]);
        candidate.needsReview = true;
      }
      if (transfers.length > 0) {
        candidate.isPotentialTransfer = true;
        candidate.potentialTransferMatch = transfers[0]; // Store best match
        if (candidate.importId) candidate.needsReview = true;
      }
    }

    if (candidate.id && data.needsReview === false) {
      if (current?.needsReview) {
        const duplicateBlockReason = getDuplicateApprovalBlockReason(current, candidate);
        if (duplicateBlockReason) {
          return NextResponse.json(
            { error: duplicateBlockReason },
            { status: 409 }
          );
        }
        const categories = await getCategories(workspaceId);
        if (!isTransactionSufficientlyClassified(candidate, categories, accounts, workspaceId)) {
          const transferValidation = validateInternalTransfer(candidate, accounts, workspaceId);
          return NextResponse.json(
            { error: transferValidation.valid
              ? 'Choose a valid category and subcategory before completing review.'
              : transferValidation.reason },
            { status: 409 }
          );
        }
      }
    }

    const result = await saveTransaction(workspaceId, candidate);
    return NextResponse.json(result);
  } catch (e: unknown) {
    const status = e instanceof TransferResolutionError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Request failed' }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, workspaceId, transactionId, importId } = body;

    if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });

    if (action === 'linkExistingTransfer') {
      if (!transactionId || !body.candidateId) {
        return NextResponse.json({ error: 'transactionId and candidateId required' }, { status: 400 });
      }
      const result = await linkExistingTransferPair(workspaceId, transactionId, body.candidateId);
      return NextResponse.json(result);
    }

    if (action === 'createTransferCounterpart') {
      if (!transactionId) {
        return NextResponse.json({ error: 'transactionId required' }, { status: 400 });
      }
      const result = await createCounterpartForExisting(
        workspaceId,
        transactionId,
        body.allowCandidateOverride === true
      );
      return NextResponse.json(result);
    }

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
      const categories = await getCategories(workspaceId);
      const accounts = await getAccounts(workspaceId);
      if (!isTransactionSufficientlyClassified(transaction, categories, accounts, workspaceId)) {
        const transferValidation = validateInternalTransfer(transaction, accounts, workspaceId);
        return NextResponse.json(
          { error: transferValidation.valid
            ? 'Choose a valid category and subcategory before approving this transaction.'
            : transferValidation.reason },
          { status: 409 }
        );
      }
      await confirmTransaction(workspaceId, transactionId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e: unknown) {
    if (e instanceof TransferCandidatesExistError) {
      return NextResponse.json(
        {
          error: e.message,
          requiresCandidateOverride: true,
          candidates: e.candidates,
        },
        { status: e.status }
      );
    }
    const status = e instanceof TransferResolutionError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Request failed' }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { workspaceId, id, importId } = body;

    if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });

    if (importId) {
      await deleteTransactionsByImport(workspaceId, importId);
    } else if (id) {
      await deleteTransaction(workspaceId, id);
    } else {
      return NextResponse.json({ error: 'Provide id or importId' }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const status = e instanceof TransferResolutionError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Request failed' }, { status });
  }
}
