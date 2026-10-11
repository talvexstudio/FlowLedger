import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExpenseCategoryVisualization, NON_POSITIVE_CATEGORY_COLOR } from './expense-category-visualization';

const category = (id: string, netExpense: number) => ({
  categoryId: id,
  categoryName: id,
  grossExpense: Math.max(netExpense, 0),
  reimbursements: Math.max(-netExpense, 0),
  netExpense,
  total: netExpense,
});

test('pie contains only positive categories while the signed list contains every category', () => {
  const visualization = buildExpenseCategoryVisualization([
    category('positive', 100),
    category('zero', 0),
    category('negative', -25),
  ]);

  assert.deepEqual(visualization.pieItems.map(({ categoryId }) => categoryId), ['positive']);
  assert.deepEqual(visualization.listItems.map(({ categoryId }) => categoryId), ['positive', 'zero', 'negative']);
  assert.equal(visualization.hasNonPositiveCategories, true);
});

test('positive pie and list entries share colors while zero and negative entries are neutral', () => {
  const visualization = buildExpenseCategoryVisualization([
    category('first', 100),
    category('second', 50),
    category('zero', 0),
    category('negative', -10),
  ]);

  for (const pieItem of visualization.pieItems) {
    assert.equal(
      visualization.listItems.find((item) => item.categoryId === pieItem.categoryId)?.color,
      pieItem.color
    );
  }
  assert.equal(visualization.listItems.find((item) => item.categoryId === 'zero')?.color, NON_POSITIVE_CATEGORY_COLOR);
  assert.equal(visualization.listItems.find((item) => item.categoryId === 'negative')?.color, NON_POSITIVE_CATEGORY_COLOR);
});
