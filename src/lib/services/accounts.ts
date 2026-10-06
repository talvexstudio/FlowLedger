import { db, hasTransactionsForAccount } from "./firestore";
import type { Account } from "../types";

const accountsCollection = (workspaceId: string) => `workspaces/${workspaceId}/accounts`;

export const getAccounts = async (workspaceId: string): Promise<Account[]> => {
    const snapshot = await db.collection(accountsCollection(workspaceId)).get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Account));
}

export const getAccount = async (
    workspaceId: string,
    accountId: string
): Promise<Account | null> => {
    const snapshot = await db.collection(accountsCollection(workspaceId)).doc(accountId).get();
    return snapshot.exists ? ({ id: accountId, ...snapshot.data() } as Account) : null;
}

export const requireAccount = async (workspaceId: string, accountId: string): Promise<Account> => {
    const account = await getAccount(workspaceId, accountId);
    if (!account) throw new Error('Account not found in the selected workspace.');
    return account;
}

export const saveAccount = async (workspaceId: string, accountData: Partial<Account>) => {
    const coll = db.collection(accountsCollection(workspaceId));
    if (accountData.id) {
        const { id, ...data } = accountData;
        await requireAccount(workspaceId, id);
        await coll.doc(id).set(data, { merge: true });
        return { ...data, id };
    } else {
        const docRef = await coll.add({
            ...accountData,
            archived: false,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        const newAccount = { ...accountData, id: docRef.id };
        return newAccount;
    }
}

export const archiveAccount = async (workspaceId: string, accountId: string) => {
    await requireAccount(workspaceId, accountId);
    await db.collection(accountsCollection(workspaceId)).doc(accountId).update({ archived: true });
}

export const deleteAccount = async (workspaceId: string, accountId: string) => {
    await requireAccount(workspaceId, accountId);
    if (await hasTransactionsForAccount(workspaceId, accountId)) {
        throw new Error("This account has transactions and cannot be deleted.");
    }
    
    await db.collection(accountsCollection(workspaceId)).doc(accountId).delete();
}
