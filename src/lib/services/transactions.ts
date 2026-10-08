import { db } from "./firestore";
import type { Account, Transaction } from "../types";
import { getAccounts } from './accounts';
import { getCategories } from './categories';
import { validateCategorySelection } from '../category-ownership';
import { normalizeTransactionTypeFields, validateInternalTransfer } from '../internal-transfer';
import { findPotentialTransfers } from '../utils/duplicate-utils';
import { normalizeTransactionComments } from '../transaction-comments';
import {
    assertWorkspaceDocumentExists,
    assertWorkspaceExists,
} from './workspace-integrity';

const transactionsCollection = (workspaceId: string) => `workspaces/${workspaceId}/transactions`;

const amountToCents = (amount: number) => Math.round(amount * 100);
const directionForAmount = (amount: number): 'Out' | 'In' => amount < 0 ? 'Out' : 'In';

const validateTransactionWorkspaceReferences = async (
    workspaceId: string,
    transaction: Partial<Transaction>
) => {
    await assertWorkspaceExists(workspaceId);
    const accounts = await getAccounts(workspaceId);
    const accountIds = new Set(accounts.map((account) => account.id));
    if (!transaction.accountId || !accountIds.has(transaction.accountId)) {
        throw new Error('Transaction account not found in the selected workspace.');
    }
    if (
        transaction.destinationAccountId &&
        !accountIds.has(transaction.destinationAccountId)
    ) {
        throw new Error('Counterpart account not found in the selected workspace.');
    }
    if (transaction.importId) {
        await assertWorkspaceDocumentExists(
            workspaceId,
            'imports',
            transaction.importId,
            'Import session'
        );
    }
    if (transaction.linkedTransactionId) {
        if (transaction.id && transaction.linkedTransactionId === transaction.id) {
            throw new Error('A transaction cannot link to itself.');
        }
        await assertWorkspaceDocumentExists(
            workspaceId,
            'transactions',
            transaction.linkedTransactionId,
            'Linked transaction'
        );
    }
    if (transaction.categoryId || transaction.subcategoryId) {
        const categories = await getCategories(workspaceId);
        validateCategorySelection(
            categories,
            workspaceId,
            transaction.categoryId,
            transaction.subcategoryId
        );
    }
};

export class TransferResolutionError extends Error {
    constructor(message: string, public readonly status = 409) {
        super(message);
        this.name = 'TransferResolutionError';
    }
}

export class TransferCandidatesExistError extends TransferResolutionError {
    constructor(public readonly candidates: Transaction[]) {
        super('Possible matching transactions already exist. Confirm that another counterpart should be created.', 409);
        this.name = 'TransferCandidatesExistError';
    }
}

export const assertLinkedTransferMutationAllowed = (
    current: Partial<Transaction>,
    candidate: Partial<Transaction>,
    linked: Partial<Transaction>,
    currentId: string
) => {
    if (candidate.type !== 'InternalTransfer') {
        throw new TransferResolutionError('A linked transfer pair cannot be converted to another transaction type.');
    }
    if (candidate.accountId !== current.accountId) {
        throw new TransferResolutionError('The account of a linked transfer pair cannot be changed independently.');
    }
    if (candidate.destinationAccountId !== linked.accountId) {
        throw new TransferResolutionError('The counterpart account of a linked transfer pair cannot be changed.');
    }
    if (candidate.internalDirection !== current.internalDirection) {
        throw new TransferResolutionError('The direction of a linked transfer pair cannot be changed independently.');
    }
    if (candidate.linkedTransactionId !== current.linkedTransactionId) {
        throw new TransferResolutionError('The reciprocal link of a transfer pair cannot be changed independently.');
    }
    if (
        typeof candidate.amountBase !== 'number' ||
        typeof current.amountBase !== 'number' ||
        amountToCents(candidate.amountBase) !== amountToCents(current.amountBase)
    ) {
        throw new TransferResolutionError('The amount of a linked transfer pair cannot be changed independently.');
    }
    if (
        linked.linkedTransactionId !== currentId ||
        linked.destinationAccountId !== current.accountId ||
        linked.accountId !== current.destinationAccountId ||
        typeof linked.amountBase !== 'number' ||
        amountToCents(Math.abs(linked.amountBase)) !== amountToCents(Math.abs(current.amountBase)) ||
        Math.sign(linked.amountBase) === Math.sign(current.amountBase)
    ) {
        throw new TransferResolutionError('The linked transfer pair is inconsistent and cannot be edited independently.');
    }
};

export const assertTransactionDeletionAllowed = (transaction: Partial<Transaction> | null) => {
    if (transaction?.linkedTransactionId) {
        throw new TransferResolutionError(
            'A single leg of a linked transfer cannot be deleted. Pair deletion is not supported yet.'
        );
    }
};

const normalizeAmountBase = (transactionData: Partial<Transaction>) => {
    if (typeof transactionData.amountBase !== "number" || !transactionData.type) {
        return transactionData;
    }
    const absAmount = Math.abs(transactionData.amountBase);
    if (transactionData.type === "Expense") {
        return { ...transactionData, amountBase: -absAmount };
    }
    if (transactionData.type === "Income") {
        return { ...transactionData, amountBase: absAmount };
    }
    // InternalTransfer and Adjustment keep provided sign
    return transactionData;
};

const enforceInternalTransferReview = async (
    workspaceId: string,
    transactionData: Partial<Transaction>
) => {
    if (transactionData.type !== 'InternalTransfer') return transactionData;
    const accounts = await getAccounts(workspaceId);
    return validateInternalTransfer(transactionData, accounts, workspaceId).valid
        ? transactionData
        : { ...transactionData, needsReview: true };
};

export const getTransactions = async (workspaceId: string): Promise<Transaction[]> => {
    const snapshot = await db.collection(transactionsCollection(workspaceId)).get();
    return snapshot.docs.map(doc => {
        const data = doc.data() as any;
        return { 
            id: doc.id, 
            ...data,
            date: new Date(data.date), // Ensure date is a Date object
            ...(data.postingDate ? { postingDate: new Date(data.postingDate) } : {}),
            ...(data.valueDate ? { valueDate: new Date(data.valueDate) } : {}),
        } as Transaction;
    });
}

export const getTransaction = async (
    workspaceId: string,
    transactionId: string
): Promise<Transaction | null> => {
    const transactions = await getTransactions(workspaceId);
    return transactions.find(transaction => transaction.id === transactionId) ?? null;
}

type TransactionWriteOptions = {
    allowProvisionalTransferLink?: boolean;
};

export const saveTransaction = async (
    workspaceId: string,
    transactionData: Partial<Transaction>,
    options: TransactionWriteOptions = {}
) => {
    await assertWorkspaceExists(workspaceId);
    const coll = db.collection(transactionsCollection(workspaceId));
    if (transactionData.id) {
        const currentSnapshot = await coll.doc(transactionData.id).get();
        if (!currentSnapshot.exists) {
            throw new Error('Transaction not found in the selected workspace.');
        }
        const current = currentSnapshot.data() as Partial<Transaction> | undefined;
        let merged = normalizeTransactionComments(normalizeTransactionTypeFields({
            ...current,
            ...transactionData,
            workspaceId,
        }));
        if (current?.linkedTransactionId) {
            const linkedSnapshot = await coll.doc(current.linkedTransactionId).get();
            const linked = linkedSnapshot.data() as Partial<Transaction> | undefined;
            if (!linked) throw new TransferResolutionError('The linked transfer record could not be found.');
            assertLinkedTransferMutationAllowed(current, merged, linked, transactionData.id);
        }
        merged = await enforceInternalTransferReview(workspaceId, merged);
        const normalizedData = normalizeAmountBase(merged);
        await validateTransactionWorkspaceReferences(workspaceId, normalizedData);
        if (
            normalizedData.linkedTransactionId &&
            !current?.linkedTransactionId &&
            !options.allowProvisionalTransferLink
        ) {
            throw new TransferResolutionError(
                'Use the dedicated transfer-pair operation to create a reciprocal link.'
            );
        }
        const { id, ...data } = normalizedData;
        await coll.doc(transactionData.id).set({
            ...data,
            updatedAt: new Date(),
        });
        return { ...data, id: transactionData.id };
    } else {
        const normalizedFields = normalizeTransactionComments(normalizeTransactionTypeFields({
            ...transactionData,
            workspaceId,
        }));
        const normalizedData = normalizeAmountBase(
            await enforceInternalTransferReview(workspaceId, normalizedFields)
        );
        await validateTransactionWorkspaceReferences(workspaceId, normalizedData);
        if (normalizedData.linkedTransactionId && !options.allowProvisionalTransferLink) {
            throw new TransferResolutionError(
                'Use the dedicated transfer-pair operation to create a reciprocal link.'
            );
        }
        const docRef = await coll.add({
            ...normalizedData,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        const newTransaction = { ...normalizedData, id: docRef.id };
        return newTransaction;
    }
}

export type InternalTransferPairDependencies = {
    getAccounts: (workspaceId: string) => Promise<Account[]>;
    saveTransaction: (workspaceId: string, transaction: Partial<Transaction>) => ReturnType<typeof saveTransaction>;
    linkSource: (workspaceId: string, sourceId: string, destinationId: string) => Promise<void>;
};

const defaultInternalTransferPairDependencies: InternalTransferPairDependencies = {
    getAccounts,
    saveTransaction: (workspaceId, transaction) =>
        saveTransaction(workspaceId, transaction, { allowProvisionalTransferLink: true }),
    linkSource: async (workspaceId, sourceId, destinationId) => {
        await assertWorkspaceDocumentExists(
            workspaceId,
            'transactions',
            destinationId,
            'Linked transaction'
        );
        await db.collection(transactionsCollection(workspaceId)).doc(sourceId).set(
            { linkedTransactionId: destinationId },
            { merge: true }
        );
    },
};

export const confirmTransaction = async (workspaceId: string, transactionId: string) => {
    await assertWorkspaceExists(workspaceId);
    const transaction = await getTransaction(workspaceId, transactionId);
    if (!transaction) throw new Error('Transaction not found');
    if (transaction.type === 'InternalTransfer') {
        const accounts = await getAccounts(workspaceId);
        const validation = validateInternalTransfer(transaction, accounts, workspaceId);
        if (!validation.valid) throw new Error(validation.reason);
    }
    await db.collection(transactionsCollection(workspaceId)).doc(transactionId).update({ needsReview: false });
}

export const deleteTransaction = async (workspaceId: string, transactionId: string) => {
    await assertWorkspaceExists(workspaceId);
    const transaction = await getTransaction(workspaceId, transactionId);
    assertTransactionDeletionAllowed(transaction);
    await db.collection(transactionsCollection(workspaceId)).doc(transactionId).delete();
}

export const createInternalTransferPair = async (
    workspaceId: string,
    sourceData: Partial<Transaction>,
    dependencies: InternalTransferPairDependencies = defaultInternalTransferPairDependencies
): Promise<{ source: Partial<Transaction>; destination: Partial<Transaction> }> => {
    const { destinationAccountId, internalDirection, amountBase, description, comments, ...shared } = sourceData;
    const accounts = await dependencies.getAccounts(workspaceId);
    const validation = validateInternalTransfer(sourceData, accounts, workspaceId);
    if (!validation.valid) throw new Error(validation.reason);

    const absAmount = Math.abs(amountBase ?? 0);
    const sourceAmount = internalDirection === 'Out' ? -absAmount : absAmount;
    const destAmount = -sourceAmount;
    const destDirection = internalDirection === 'Out' ? 'In' : 'Out';

    // Save source transaction first
    const source = await dependencies.saveTransaction(workspaceId, {
        ...shared,
        description,
        comments,
        amountBase: sourceAmount,
        amountOriginal: sourceAmount,
        type: 'InternalTransfer',
        isInternalTransfer: true,
        internalDirection,
        destinationAccountId: destinationAccountId!,
    });

    // Save destination transaction
    const destination = await dependencies.saveTransaction(workspaceId, {
        ...shared,
        accountId: destinationAccountId!,
        description: description ? `Transfer: ${description}` : 'Internal Transfer',
        amountBase: destAmount,
        amountOriginal: destAmount,
        type: 'InternalTransfer',
        isInternalTransfer: true,
        internalDirection: destDirection,
        destinationAccountId: shared.accountId,
        linkedTransactionId: source.id,
    });

    // Link source back to destination
    await dependencies.linkSource(workspaceId, source.id as string, destination.id as string);

    return { source: { ...source, linkedTransactionId: destination.id }, destination };
};

export const deleteTransactionsByImport = async (
    workspaceId: string,
    importId: string
): Promise<void> => {
    await assertWorkspaceExists(workspaceId);
    await assertWorkspaceDocumentExists(workspaceId, 'imports', importId, 'Import session');
    const coll = db.collection(transactionsCollection(workspaceId));
    const snapshot = await coll.where("importId", "==", importId).get();
    const selectedIds = new Set(snapshot.docs.map((doc) => doc.id));
    for (const doc of snapshot.docs) {
        const linkedTransactionId = doc.data().linkedTransactionId;
        if (linkedTransactionId && !selectedIds.has(linkedTransactionId)) {
            throw new TransferResolutionError(
                'The import contains one leg of a linked transfer. Delete it through Import History with both legs in scope.'
            );
        }
    }
    for (const doc of snapshot.docs) {
        await coll.doc(doc.id).delete();
    }
}

export type TransferResolutionDependencies = {
    getTransaction: (workspaceId: string, transactionId: string) => Promise<Transaction | null>;
    getTransactions: (workspaceId: string) => Promise<Transaction[]>;
    getAccounts: (workspaceId: string) => Promise<Account[]>;
    writeTransaction: (workspaceId: string, transaction: Transaction) => Promise<Transaction>;
    createTransaction: (workspaceId: string, transaction: Partial<Transaction>) => Promise<Transaction>;
    deleteCreatedTransaction: (workspaceId: string, transactionId: string) => Promise<void>;
};

const writeTransactionRecord = async (
    workspaceId: string,
    transaction: Transaction
): Promise<Transaction> => {
    await validateTransactionWorkspaceReferences(workspaceId, transaction);
    const { id, ...data } = transaction;
    const updated = { ...data, workspaceId, updatedAt: new Date() } as Omit<Transaction, 'id'>;
    await db.collection(transactionsCollection(workspaceId)).doc(id).set(updated);
    return { ...updated, id };
};

const defaultTransferResolutionDependencies: TransferResolutionDependencies = {
    getTransaction,
    getTransactions,
    getAccounts,
    writeTransaction: writeTransactionRecord,
    createTransaction: async (workspaceId, transaction) =>
        await saveTransaction(
            workspaceId,
            transaction,
            { allowProvisionalTransferLink: true }
        ) as Transaction,
    deleteCreatedTransaction: async (workspaceId, transactionId) => {
        await db.collection(transactionsCollection(workspaceId)).doc(transactionId).delete();
    },
};

const validateResolutionSource = async (
    workspaceId: string,
    sourceId: string,
    dependencies: TransferResolutionDependencies
) => {
    const source = await dependencies.getTransaction(workspaceId, sourceId);
    if (!source) throw new TransferResolutionError('Source transaction not found.', 404);
    if (source.workspaceId !== workspaceId) {
        throw new TransferResolutionError('The source transaction does not belong to this workspace.');
    }
    if (source.type !== 'InternalTransfer') {
        throw new TransferResolutionError('Only an InternalTransfer can be resolved.');
    }
    if (source.linkedTransactionId) {
        throw new TransferResolutionError('This transfer is already linked.');
    }
    const accounts = await dependencies.getAccounts(workspaceId);
    const validation = validateInternalTransfer(source, accounts, workspaceId);
    if (!validation.valid) throw new TransferResolutionError(validation.reason);
    if (!source.amountBase || directionForAmount(source.amountBase) !== source.internalDirection) {
        throw new TransferResolutionError('Transfer direction must agree with the signed amount.');
    }
    return { source, accounts };
};

const findCandidatesForSource = async (
    workspaceId: string,
    source: Transaction,
    dependencies: TransferResolutionDependencies
) => {
    const transactions = await dependencies.getTransactions(workspaceId);
    return findPotentialTransfers(source, transactions, {
        workspaceId,
        counterpartAccountId: source.destinationAccountId,
        sourceTransactionId: source.id,
        excludeLinked: true,
        maxCalendarDayDifference: 1,
    }).map((match) => ({
        transaction: match.existingTransaction,
        calendarDayDifference: match.calendarDayDifference ?? 0,
    }));
};

export const findTransferCounterpartCandidates = async (
    workspaceId: string,
    sourceId: string,
    dependencies: TransferResolutionDependencies = defaultTransferResolutionDependencies
) => {
    const { source } = await validateResolutionSource(workspaceId, sourceId, dependencies);
    return findCandidatesForSource(workspaceId, source, dependencies);
};

const restoreSnapshots = async (
    workspaceId: string,
    snapshots: Transaction[],
    dependencies: TransferResolutionDependencies
) => {
    const failures: string[] = [];
    for (const snapshot of snapshots) {
        try {
            await dependencies.writeTransaction(workspaceId, snapshot);
        } catch {
            failures.push(snapshot.id);
        }
    }
    if (failures.length > 0) {
        throw new Error(`Rollback failed for transaction(s): ${failures.join(', ')}`);
    }
};

export const linkExistingTransferPair = async (
    workspaceId: string,
    sourceId: string,
    candidateId: string,
    dependencies: TransferResolutionDependencies = defaultTransferResolutionDependencies
): Promise<{ source: Transaction; counterpart: Transaction }> => {
    if (sourceId === candidateId) {
        throw new TransferResolutionError('A transaction cannot be linked to itself.');
    }
    const { source, accounts } = await validateResolutionSource(workspaceId, sourceId, dependencies);
    const candidate = await dependencies.getTransaction(workspaceId, candidateId);
    if (!candidate) throw new TransferResolutionError('Counterpart transaction not found.', 404);
    if (candidate.workspaceId !== workspaceId) {
        throw new TransferResolutionError('Both transactions must belong to the same workspace.');
    }
    if (candidate.linkedTransactionId) {
        throw new TransferResolutionError('The selected counterpart is already linked.');
    }
    if (candidate.accountId === source.accountId) {
        throw new TransferResolutionError('Transfer legs must belong to different accounts.');
    }
    if (source.destinationAccountId !== candidate.accountId) {
        throw new TransferResolutionError('The selected transaction is not in the chosen counterpart account.');
    }
    if (
        candidate.type === 'InternalTransfer' &&
        candidate.destinationAccountId &&
        candidate.destinationAccountId !== source.accountId
    ) {
        throw new TransferResolutionError('The selected transfer points to a different counterpart account.');
    }
    if (!accounts.some((account) => account.id === candidate.accountId && account.workspaceId === workspaceId)) {
        throw new TransferResolutionError('The counterpart account does not belong to this workspace.');
    }

    const matches = await findCandidatesForSource(workspaceId, source, {
        ...dependencies,
        getTransactions: async () => [candidate],
    });
    if (!matches.some((match) => match.transaction.id === candidate.id)) {
        throw new TransferResolutionError(
            'The selected transaction must have the opposite sign, the same cent amount, and a date within one day.'
        );
    }

    const sourceDirection = directionForAmount(source.amountBase);
    const counterpartDirection: 'Out' | 'In' = sourceDirection === 'Out' ? 'In' : 'Out';
    const linkedSource = normalizeTransactionTypeFields({
        ...source,
        type: 'InternalTransfer',
        isInternalTransfer: true,
        internalDirection: sourceDirection,
        destinationAccountId: candidate.accountId,
        linkedTransactionId: candidate.id,
        needsReview: source.isPotentialDuplicate,
        isPotentialTransfer: false,
        potentialTransferMatch: undefined,
    }) as Transaction;
    const linkedCounterpart = normalizeTransactionTypeFields({
        ...candidate,
        type: 'InternalTransfer',
        isInternalTransfer: true,
        internalDirection: counterpartDirection,
        destinationAccountId: source.accountId,
        linkedTransactionId: source.id,
        needsReview: candidate.isPotentialDuplicate,
        isPotentialTransfer: false,
        potentialTransferMatch: undefined,
    }) as Transaction;

    try {
        const savedSource = await dependencies.writeTransaction(workspaceId, linkedSource);
        const savedCounterpart = await dependencies.writeTransaction(workspaceId, linkedCounterpart);
        return { source: savedSource, counterpart: savedCounterpart };
    } catch (error) {
        try {
            await restoreSnapshots(workspaceId, [source, candidate], dependencies);
        } catch (rollbackError) {
            throw new TransferResolutionError(
                `Linking failed and rollback was incomplete: ${rollbackError instanceof Error ? rollbackError.message : 'unknown rollback error'}`,
                500
            );
        }
        throw new TransferResolutionError(
            `Linking failed; both original transactions were restored. ${error instanceof Error ? error.message : ''}`.trim(),
            500
        );
    }
};

export const createCounterpartForExisting = async (
    workspaceId: string,
    sourceId: string,
    allowCandidateOverride = false,
    dependencies: TransferResolutionDependencies = defaultTransferResolutionDependencies
): Promise<{ source: Transaction; counterpart: Transaction }> => {
    const { source } = await validateResolutionSource(workspaceId, sourceId, dependencies);
    const candidates = await findCandidatesForSource(workspaceId, source, dependencies);
    if (candidates.length > 0 && !allowCandidateOverride) {
        throw new TransferCandidatesExistError(candidates.map((candidate) => candidate.transaction));
    }

    const sourceDirection = directionForAmount(source.amountBase);
    const counterpartDirection: 'Out' | 'In' = sourceDirection === 'Out' ? 'In' : 'Out';
    let createdCounterpart: Transaction | null = null;
    try {
        createdCounterpart = await dependencies.createTransaction(workspaceId, {
            workspaceId,
            accountId: source.destinationAccountId!,
            date: source.date,
            postingDate: source.postingDate,
            valueDate: source.valueDate,
            description: source.description ? `Transfer: ${source.description}` : 'Internal Transfer',
            rawDescription: source.rawDescription,
            amountOriginal: -source.amountBase,
            currencyOriginal: source.currencyOriginal,
            amountBase: -source.amountBase,
            exchangeRate: source.exchangeRate,
            type: 'InternalTransfer',
            needsReview: false,
            isInternalTransfer: true,
            internalDirection: counterpartDirection,
            destinationAccountId: source.accountId,
            linkedTransactionId: source.id,
            isPotentialDuplicate: false,
            isPotentialTransfer: false,
            isInconsistent: false,
        });

        const linkedSource = normalizeTransactionTypeFields({
            ...source,
            internalDirection: sourceDirection,
            linkedTransactionId: createdCounterpart.id,
            needsReview: source.isPotentialDuplicate,
            isPotentialTransfer: false,
            potentialTransferMatch: undefined,
        }) as Transaction;
        const savedSource = await dependencies.writeTransaction(workspaceId, linkedSource);
        return { source: savedSource, counterpart: createdCounterpart };
    } catch (error) {
        const rollbackFailures: string[] = [];
        try {
            await dependencies.writeTransaction(workspaceId, source);
        } catch {
            rollbackFailures.push('source restoration');
        }
        if (createdCounterpart?.id) {
            try {
                await dependencies.deleteCreatedTransaction(workspaceId, createdCounterpart.id);
            } catch {
                rollbackFailures.push('counterpart removal');
            }
        }
        if (rollbackFailures.length > 0) {
            throw new TransferResolutionError(
                `Counterpart creation failed and rollback was incomplete: ${rollbackFailures.join(', ')}.`,
                500
            );
        }
        throw new TransferResolutionError(
            `Counterpart creation failed; no reciprocal transaction was retained. ${error instanceof Error ? error.message : ''}`.trim(),
            500
        );
    }
};
