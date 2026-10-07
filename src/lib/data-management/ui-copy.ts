import type { DataResetOperation } from './data-reset';

export const CLEAR_RESET_SECTION_TITLE = 'Clear & Reset Data';
export const CLEAR_RESET_SECTION_DESCRIPTION =
  'Review the exact impact before clearing or resetting local FlowLedger data.';

export const RESET_OPTIONS: Record<DataResetOperation, {
  title: string;
  description: string;
  confirmation: string;
  action: string;
}> = {
  clear_activity: {
    title: 'Clear Activity',
    description: 'Remove all transactions and import history while keeping financial setup and workspaces.',
    confirmation: 'I understand that all transactions and import history will be removed.',
    action: 'Clear activity',
  },
  reset_financial: {
    title: 'Reset Financial Data',
    description: 'Remove accounts and all financial activity and configuration, reset categories to the starter set, and keep workspaces.',
    confirmation: 'I understand that all financial data will be removed while workspaces are preserved.',
    action: 'Reset financial data',
  },
  factory_reset: {
    title: 'Factory Reset',
    description: 'Remove all local FlowLedger data and return to the default workspace and starter categories.',
    confirmation: 'I understand that all FlowLedger data will be replaced with the default local setup.',
    action: 'Factory reset',
  },
};

export const formatCount = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;
