'use client';

import { useFlowLedger } from '@/hooks/use-flow-ledger';

export function AppLoadingGuard({ children }: { children: React.ReactNode }) {
  const { isLoading } = useFlowLedger();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6 animate-pulse">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 rounded-xl bg-muted" />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="h-64 rounded-xl bg-muted" />
          <div className="h-64 rounded-xl bg-muted" />
        </div>
        <div className="h-48 rounded-xl bg-muted" />
      </div>
    );
  }

  return <>{children}</>;
}
