import type { ImportFileType } from './import-processing';

export type ImportFlowStage = 'file' | 'tabular' | 'pdf';

export const detectImportFileType = (filename: string): ImportFileType | null => {
  const normalized = filename.trim().toLowerCase();
  if (normalized.endsWith('.csv')) return 'CSV';
  if (normalized.endsWith('.xls') || normalized.endsWith('.xlsx')) return 'XLSX';
  if (normalized.endsWith('.pdf')) return 'PDF';
  return null;
};

export const getImportFlowStage = (fileType: ImportFileType | null): ImportFlowStage => {
  if (fileType === 'PDF') return 'pdf';
  if (fileType === 'CSV' || fileType === 'XLSX') return 'tabular';
  return 'file';
};
