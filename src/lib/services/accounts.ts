import { db, hasTransactionsForAccount } from "./firestore";
import type { Account } from "../types";
import { assertWorkspaceExists } from './workspace-integrity';

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
    await assertWorkspaceExists(workspaceId);
    const coll = db.collection(accountsCollection(workspaceId));
    if (accountData.id) {
        const { id, workspaceId: _workspaceId, ...data } = accountData;
        await requireAccount(workspaceId, id);
        const payload = { ...data, workspaceId };
        await coll.doc(id).set(payload, { merge: true });
        return { ...payload, id };
    } else {
        const { workspaceId: _workspaceId, ...data } = accountData;
        const docRef = await coll.add({
            ...data,
            workspaceId,
            archived: false,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        const newAccount = { ...data, workspaceId, id: docRef.id };
        return newAccount;
    }
}

export const archiveAccount = async (workspaceId: string, accountId: string) => {
    await assertWorkspaceExists(workspaceId);
    await requireAccount(workspaceId, accountId);
    await db.collection(accountsCollection(workspaceId)).doc(accountId).update({
        archived: true,
        updatedAt: new Date(),
    });
}

export const restoreAccount = async (workspaceId: string, accountId: string) => {
    await assertWorkspaceExists(workspaceId);
    await requireAccount(workspaceId, accountId);
    await db.collection(accountsCollection(workspaceId)).doc(accountId).update({
        archived: false,
        updatedAt: new Date(),
    });
}

export const deleteAccount = async (workspaceId: string, accountId: string) => {
    await assertWorkspaceExists(workspaceId);
    await requireAccount(workspaceId, accountId);
    if (await hasTransactionsForAccount(workspaceId, accountId)) {
        throw new Error("This account has transactions and cannot be deleted.");
    }
    const referenceCollections = [
        { name: 'imports', matches: (record: any) => record.accountId === accountId, label: 'import history' },
        { name: 'importTemplates', matches: (record: any) => record.defaultAccountId === accountId, label: 'import templates' },
        { name: 'rules', matches: (record: any) => record.match?.accountId === accountId, label: 'classification rules' },
    ] as const;
    for (const reference of referenceCollections) {
        const snapshot = await db.collection(`workspaces/${workspaceId}/${reference.name}`).get();
        if (snapshot.docs.some((doc) => reference.matches(doc.data()))) {
            throw new Error(`This account is referenced by ${reference.label} and cannot be deleted.`);
        }
    }
    
    await db.collection(accountsCollection(workspaceId)).doc(accountId).delete();
}
