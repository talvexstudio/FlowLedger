import assert from 'node:assert/strict';
import test from 'node:test';
import { detectImportFileType, getImportFlowStage } from './import-file-flow';

test('file-first flow has no format-specific controls before file detection', () => {
  assert.equal(getImportFlowStage(null), 'file');
});

test('CSV and XLS/XLSX enter the existing tabular mapping stage', () => {
  assert.equal(detectImportFileType('statement.csv'), 'CSV');
  assert.equal(detectImportFileType('statement.xls'), 'XLSX');
  assert.equal(detectImportFileType('statement.xlsx'), 'XLSX');
  assert.equal(getImportFlowStage('CSV'), 'tabular');
  assert.equal(getImportFlowStage('XLSX'), 'tabular');
});

test('PDF enters the PDF detection stage and unsupported extensions are rejected', () => {
  assert.equal(detectImportFileType('statement.PDF'), 'PDF');
  assert.equal(getImportFlowStage('PDF'), 'pdf');
  assert.equal(detectImportFileType('statement.txt'), null);
});
