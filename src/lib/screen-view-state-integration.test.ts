import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (relativePath: string) => readFileSync(
  new URL(relativePath, import.meta.url),
  'utf8'
);

test('Transactions persists only durable view controls and exposes an obvious active-filter state', () => {
  const table = source('../components/transactions/data-table.tsx');
  assert.match(table, /getViewStateStorageKey\('transactions', workspaceId\)/);
  assert.match(table, /Filters active · \{activeFiltersCount\}/);
  assert.match(table, /border-primary\/50/);
  assert.match(table, /Clear filters/);
  assert.match(table, /viewStatePersistence\.clear\(\)/);
  assert.match(table, /const \[selectedIds, setSelectedIds\] = React\.useState/);
  assert.doesNotMatch(table, /selectedIds:\s*viewState/);
});

test('Dashboard persists its selected period while the report dialog remains transient', () => {
  const dashboard = source('../app/(app)/dashboard/page.tsx');
  assert.match(dashboard, /getViewStateStorageKey\('dashboard', workspaceId\)/);
  assert.match(dashboard, /const \[showExpenseReport, setShowExpenseReport\] = useState\(false\)/);
  assert.doesNotMatch(dashboard, /showConfirmDialog/);
  assert.doesNotMatch(dashboard, /Load Demo Data/);
  assert.doesNotMatch(dashboard, /apiSeedDemoData/);
  assert.doesNotMatch(dashboard, /showExpenseReport:\s*dashboardViewState/);
});

test('Budget persists month and year while planning dialogs and unsaved amounts remain transient', () => {
  const budget = source('../app/(app)/budget/page.tsx');
  assert.match(budget, /getViewStateStorageKey\('budget', workspaceId\)/);
  assert.match(budget, /const \[amountInput, setAmountInput\] = useState\(''\)/);
  assert.match(budget, /const \[copyDialogRequest, setCopyDialogRequest\] = useState/);
  assert.match(budget, /const \[suggestionDialogOpen, setSuggestionDialogOpen\] = useState\(false\)/);
});

test('Settings persists only its active tab and Factory Reset clears FlowLedger view preferences', () => {
  const settings = source('../app/(app)/settings/page.tsx');
  const storage = source('../components/settings/data-storage-panel.tsx');
  assert.match(settings, /getViewStateStorageKey\('settings'\)/);
  assert.match(settings, /value=\{settingsViewState\.tab\}/);
  assert.match(storage, /resetPreview\.operation === 'factory_reset'/);
  assert.match(storage, /clearAllPersistedViewState\(getBrowserViewStateStorage\(\)\)/);
});
