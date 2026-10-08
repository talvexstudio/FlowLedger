import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  detectPdfStatement,
  extractPdfStatement,
  listSupportedPdfTemplates,
  PdfExtractionError,
} from '@/lib/server/pdf-extraction';

const python = process.env.PDF_IMPORT_PYTHON?.trim() || (process.platform === 'win32' ? 'python' : 'python3');
const pythonProbe = spawnSync(python, ['-c', 'import pymupdf'], {
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1' },
  windowsHide: true,
});
const hasPyMuPdf = pythonProbe.status === 0;
const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'flowledger-pdf-detection-'));

const fixtureLines = {
  activobank: [
    'Banco ActivoBank',
    'DEPOSITO A ORDEM',
    'CONTA SIMPLES',
    'EXTRATO DE',
    'DATA DATA LANC VALOR DESCRITIVO DEBITO CREDITO SALDO',
  ],
  cgd: [
    'Caixa Geral de Depositos',
    'Extrato Global',
    'CONTA EXTRACTO',
    'Saldo Contabilistico',
    'Patrimonio Depositos a Ordem CONTA EXTRACTO',
    'DATA DATA MOV VALOR VALOR DESCRICAO SALDO CONTABILISTICO',
  ],
  revolut: [
    'Extrato de EUR',
    'Revolut Bank UAB',
    'Resumo do saldo',
    'Operacoes da conta de',
    'DATA DESCRICAO DINHEIRO DINHEIRO RETIRADO RECEBIDO SALDO',
  ],
} as const;

const createPdf = (name: string, pages: readonly (readonly string[])[]) => {
  const output = path.join(temporaryRoot, `${name}.pdf`);
  const script = [
    'import json, pymupdf, sys',
    'doc = pymupdf.open()',
    'pages = json.loads(sys.argv[2])',
    'for lines in pages:',
    '    page = doc.new_page(width=595, height=842)',
    '    for index, text in enumerate(lines):',
    '        page.insert_text((40, 50 + index * 18), text, fontsize=6)',
    'doc.save(sys.argv[1])',
  ].join('\n');
  const result = spawnSync(python, ['-c', script, output, JSON.stringify(pages)], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1' },
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  return readFileSync(output);
};

test.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));

for (const [family, expectedParserId] of [
  ['activobank', 'activobank-current-account-v1'],
  ['cgd', 'cgd-current-account-v1'],
  ['revolut', 'revolut-current-account-v1'],
] as const) {
  test(`known PDF detection identifies ${family}`, { skip: !hasPyMuPdf }, async () => {
    const bytes = createPdf(family, [fixtureLines[family]]);
    const result = await detectPdfStatement(bytes);
    assert.equal(result.decision, 'single_match');
    assert.deepEqual(
      result.candidates.filter((candidate) => candidate.matched).map((candidate) => candidate.parserId),
      [expectedParserId]
    );
  });
}

test('unknown selectable PDF returns no_match without returning source text', { skip: !hasPyMuPdf }, async () => {
  const bytes = createPdf('unknown', [['PRIVATE-SENTINEL-ACCOUNT-999', 'Date Description Amount Balance']]);
  const result = await detectPdfStatement(bytes);
  assert.equal(result.decision, 'no_match');
  assert.equal(JSON.stringify(result).includes('PRIVATE-SENTINEL'), false);
});

test('image-only or blank PDF returns unusable_pdf', { skip: !hasPyMuPdf }, async () => {
  const result = await detectPdfStatement(createPdf('blank', [[]]));
  assert.equal(result.decision, 'unusable_pdf');
  assert.equal(result.document.selectableTextPageCount, 0);
});

test('multiple qualifying definitions return a deterministic multiple-match decision', { skip: !hasPyMuPdf }, async () => {
  const result = await detectPdfStatement(createPdf('multiple', [[
    ...fixtureLines.activobank,
    ...fixtureLines.cgd,
    ...fixtureLines.revolut,
  ]]));
  assert.equal(result.decision, 'multiple_matches');
  assert.deepEqual(
    result.candidates.filter((candidate) => candidate.matched).map((candidate) => candidate.parserId),
    listSupportedPdfTemplates().map((template) => template.id)
  );
});

test('a blank ancillary page does not make an otherwise selectable statement unusable', { skip: !hasPyMuPdf }, async () => {
  const result = await detectPdfStatement(createPdf('ancillary-blank', [fixtureLines.activobank, []]));
  assert.equal(result.decision, 'single_match');
  assert.equal(result.document.pageCount, 2);
  assert.equal(result.document.selectableTextPageCount, 1);
});

test('manual parser fallback still rejects a mismatched statement definition', { skip: !hasPyMuPdf }, async () => {
  const bytes = createPdf('manual-mismatch', [fixtureLines.activobank]);
  await assert.rejects(
    () => extractPdfStatement(bytes, 'manual-mismatch.pdf', 'cgd-current-account-v1'),
    (error: unknown) => error instanceof PdfExtractionError && error.code === 'TEMPLATE_MISMATCH'
  );
});
