'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ClassificationRulesTab } from '@/components/settings/classification-rules-tab';
import { CategoriesPanel } from '@/components/settings/categories-panel';
import { DataStoragePanel } from '@/components/settings/data-storage-panel';
import { usePersistedViewState } from '@/hooks/use-persisted-view-state';
import {
  isSettingsViewState,
  type SettingsTab,
} from '@/lib/screen-view-state';
import { getViewStateStorageKey } from '@/lib/view-state';

const DEFAULT_SETTINGS_VIEW_STATE = { tab: 'profile' as SettingsTab };

export default function SettingsPage() {
  const [settingsViewState, setSettingsViewState] = usePersistedViewState(
    getViewStateStorageKey('settings'),
    DEFAULT_SETTINGS_VIEW_STATE,
    isSettingsViewState
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your account and workspace settings.</p>
      </div>

      <Tabs
        value={settingsViewState.tab}
        onValueChange={(tab) => setSettingsViewState({ tab: tab as SettingsTab })}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-5">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="workspace">Workspace</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="data-storage">Data &amp; Storage</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>Manage your personal information.</CardDescription>
            </CardHeader>
            <CardContent>
              <p>Profile settings will be implemented here.</p>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="workspace">
          <Card>
            <CardHeader>
              <CardTitle>Workspace</CardTitle>
              <CardDescription>Manage your current workspace settings.</CardDescription>
            </CardHeader>
            <CardContent>
              <p>Workspace settings will be implemented here.</p>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="categories">
          <CategoriesPanel />
        </TabsContent>
        <TabsContent value="rules">
          <ClassificationRulesTab />
        </TabsContent>
        <TabsContent value="data-storage">
          <DataStoragePanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
