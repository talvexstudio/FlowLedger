import { db } from "./firestore";
import type { Category, Subcategory } from "../types";

const normalizeCategory = (category: Category & { subcategories?: Subcategory[] }) => {
    const defaultFlowType: Subcategory["flowType"] =
        category.type === "income" ? "Income" : "Expense";

    return {
        ...category,
        isActive: category.isActive !== false,
        subcategories: (category.subcategories || []).map(sub => ({
            ...sub,
            isActive: sub.isActive !== false,
            flowType: sub.flowType ?? defaultFlowType,
        })),
    };
};

export const getCategories = async (): Promise<(Category & { subcategories: Subcategory[] })[]> => {
    const snapshot = await db.collection("categories").get();
    return snapshot.docs.map(doc => {
        const data = doc.data() as Category & { subcategories?: Subcategory[] };
        return normalizeCategory({ id: doc.id, ...data });
    });
}

export const saveCategory = async (category: Category): Promise<Category> => {
    const coll = db.collection("categories");
    if (category.id) {
        await coll.doc(category.id).set(category, { merge: true });
        return category;
    }

    const docRef = await coll.add(category);
    return { ...category, id: docRef.id };
}

const generateSubcategoryId = () => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return `sub_${Math.random().toString(36).slice(2, 10)}`;
};

export const saveSubcategory = async (
    categoryId: string,
    subcategory: Subcategory
): Promise<Subcategory> => {
    const coll = db.collection("categories");
    const catDoc = await coll.doc(categoryId).get();
    const catData = catDoc.data() as Category & { subcategories?: Subcategory[] } | undefined;
    if (!catData) {
        throw new Error("Category not found.");
    }

    const subs = [...(catData.subcategories || [])];
    const existingIndex = subcategory.id
        ? subs.findIndex(s => s.id === subcategory.id)
        : -1;

    if (existingIndex >= 0) {
        subs[existingIndex] = subcategory;
    } else {
        const newId = subcategory.id && !subcategory.id.startsWith("temp-")
            ? subcategory.id
            : generateSubcategoryId();
        subs.push({ ...subcategory, id: newId });
    }

    await coll.doc(categoryId).set(
        {
            ...catData,
            subcategories: subs,
        },
        { merge: true }
    );

    return subcategory;
}
