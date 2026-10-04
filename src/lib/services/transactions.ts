import { db } from "./firestore";
import type { Transaction } from "../types";

const transactionsCollection = (workspaceId: string) => `workspaces/${workspaceId}/transactions`;

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

export const saveTransaction = async (workspaceId: string, transactionData: Partial<Transaction>) => {
    const normalizedData = normalizeAmountBase(transactionData);
    const coll = db.collection(transactionsCollection(workspaceId));
    if (normalizedData.id) {
        const { id, ...data } = normalizedData;
        await coll.doc(id).set(
            {
                ...data,
                updatedAt: new Date(),
            },
            { merge: true }
        );
        return { ...data, id };
    } else {
        const docRef = await coll.add({
            ...normalizedData,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        const newTransaction = { ...normalizedData, id: docRef.id };
        return newTransaction;
    }
}

export const confirmTransaction = async (workspaceId: string, transactionId: string) => {
    await db.collection(transactionsCollection(workspaceId)).doc(transactionId).update({ needsReview: false });
}

export const deleteTransaction = async (workspaceId: string, transactionId: string) => {
    await db.collection(transactionsCollection(workspaceId)).doc(transactionId).delete();
}

export const deleteTransactions = async (workspaceId: string, ids: string[]): Promise<void> => {
    const coll = db.collection(transactionsCollection(workspaceId));
    for (const id of ids) {
        await coll.doc(id).delete();
    }
}

export const createInternalTransferPair = async (
    workspaceId: string,
    sourceData: Partial<Transaction>
): Promise<{ source: Partial<Transaction>; destination: Partial<Transaction> }> => {
    const { destinationAccountId, internalDirection, amountBase, description, ...shared } = sourceData;
    if (!destinationAccountId) throw new Error('destinationAccountId is required for internal transfers');

    const absAmount = Math.abs(amountBase ?? 0);
    const sourceAmount = internalDirection === 'Out' ? -absAmount : absAmount;
    const destAmount = -sourceAmount;
    const destDirection = internalDirection === 'Out' ? 'In' : 'Out';

    // Save source transaction first
    const source = await saveTransaction(workspaceId, {
        ...shared,
        description,
        amountBase: sourceAmount,
        amountOriginal: sourceAmount,
        type: 'InternalTransfer',
        isInternalTransfer: true,
        internalDirection,
        destinationAccountId,
    });

    // Save destination transaction
    const destination = await saveTransaction(workspaceId, {
        ...shared,
        accountId: destinationAccountId,
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
    const coll = db.collection(transactionsCollection(workspaceId));
    await coll.doc(source.id as string).set({ linkedTransactionId: destination.id }, { merge: true });

    return { source: { ...source, linkedTransactionId: destination.id }, destination };
};

export const deleteTransactionsByImport = async (
    workspaceId: string,
    importId: string
): Promise<void> => {
    const coll = db.collection(transactionsCollection(workspaceId));
    const snapshot = await coll.where("importId", "==", importId).get();
    for (const doc of snapshot.docs) {
        await coll.doc(doc.id).delete();
    }
}
