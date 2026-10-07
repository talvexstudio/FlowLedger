import type { BackupScope } from './store-manifest';

const fallbackFilename = (scope: BackupScope) =>
  `flowledger-backup-${scope.replace(/_/g, '-')}.json`;

export const backupResponseFilename = (header: string | null, scope: BackupScope) => {
  const match = header?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? fallbackFilename(scope);
};

export const downloadBackup = async (
  scope: BackupScope,
  workspaceId?: string | null
) => {
  if (scope !== 'everything' && !workspaceId) {
    throw new Error('Choose a workspace before exporting this backup.');
  }
  const response = await fetch('/api/data-management/backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scope,
      ...(scope !== 'everything' ? { workspaceId } : {}),
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? 'Could not export the backup.');
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = backupResponseFilename(response.headers.get('Content-Disposition'), scope);
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
};
