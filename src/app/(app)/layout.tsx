import { AppSidebar } from '@/components/layout/sidebar';
import { AppHeader } from '@/components/layout/header';
import { SidebarProvider } from '@/components/ui/sidebar';
import { PrototypeBanner } from '@/components/layout/prototype-banner';
import { FlowLedgerProvider } from '@/hooks/use-flow-ledger';
import { AppLoadingGuard } from '@/components/layout/app-loading-guard';
import { ErrorBoundary } from '@/components/layout/error-boundary';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <FlowLedgerProvider>
      <SidebarProvider>
        <AppSidebar />
        <div className="flex flex-col flex-1">
          <AppHeader />
          <PrototypeBanner />
          <main className="flex-1 p-4 md:p-6 lg:p-8">
            <ErrorBoundary>
              <AppLoadingGuard>
                {children}
              </AppLoadingGuard>
            </ErrorBoundary>
          </main>
        </div>
      </SidebarProvider>
    </FlowLedgerProvider>
  );
}
