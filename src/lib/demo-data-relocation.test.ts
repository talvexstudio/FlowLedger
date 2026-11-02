import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (relativePath: string) => readFileSync(
  new URL(relativePath, import.meta.url),
  'utf8'
);

test('Dashboard no longer exposes demo-data controls', () => {
  const dashboard = source('../app/(app)/dashboard/page.tsx');
  assert.doesNotMatch(dashboard, /Load Demo Data/);
  assert.doesNotMatch(dashboard, /apiSeedDemoData/);
  assert.doesNotMatch(dashboard, /showConfirmDialog/);
});

test('Data & Storage reuses the demo-data API and preserves empty/non-empty safeguards', () => {
  const storage = source('../components/settings/data-storage-panel.tsx');
  const api = source('./api.ts');

  assert.match(storage, />Load Demo Data</);
  assert.match(storage, /apiSeedDemoData\(workspaceId, clear\)/);
  assert.match(storage, /accounts\.length === 0 && transactions\.length === 0/);
  assert.match(storage, /loadDemoData\(false\)/);
  assert.match(storage, /setDemoConfirmOpen\(true\)/);
  assert.match(storage, /loadDemoData\(true\)/);
  assert.match(storage, /Other workspaces will not be affected/);
  assert.match(storage, /<AlertDialogCancel disabled=\{demoLoading\}>Cancel<\/AlertDialogCancel>/);
  assert.match(api, /apiSeedDemoData[\s\S]*\/api\/seed/);
});

test('Data & Storage retains Settings persistence and Factory Reset view-state clearing', () => {
  const settings = source('../app/(app)/settings/page.tsx');
  const storage = source('../components/settings/data-storage-panel.tsx');

  assert.match(settings, /getViewStateStorageKey\('settings'\)/);
  assert.match(storage, /resetPreview\.operation === 'factory_reset'/);
  assert.match(storage, /clearAllPersistedViewState\(getBrowserViewStateStorage\(\)\)/);
});
