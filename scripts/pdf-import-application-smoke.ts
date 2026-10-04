import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { POST } from '../src/app/api/pdf-import/extract/route';
import { GET } from '../src/app/api/pdf-import/templates/route';
import type { PdfExtractionReport } from '../src/lib/server/pdf-extraction';

type Expected = {
  file: string;
  templateId: string;
  rows: number;
  debits: number;
  credits: number;
  transactionPages: number[];
  opening: number;
  totalDebits: number;
  totalCredits: number;
  closing: number;
  exclusionAnchors?: string[];
};

const cases: Expected[] = [
  { file: 'activobank-2026-08.pdf', templateId: 'activobank-current-account-v1', rows: 75, debits: 70, credits: 5, transactionPages: [2, 3], opening: 291.80, totalDebits: 7105.54, totalCredits: 7378.10, closing: 564.36 },
  { file: 'cgd-2026-06.pdf', templateId: 'cgd-current-account-v1', rows: 8, debits: 7, credits: 1, transactionPages: [1], opening: 16.97, totalDebits: 664.66, totalCredits: 650, closing: 2.31 },
  { file: 'cgd-2026-07.pdf', templateId: 'cgd-current-account-v1', rows: 8, debits: 7, credits: 1, transactionPages: [1], opening: 2.31, totalDebits: 664.65, totalCredits: 700, closing: 37.66 },
  { file: 'revolut-2026-01.pdf', templateId: 'revolut-current-account-v1', rows: 24, debits: 24, credits: 0, transactionPages: [1, 2], opening: 119.98, totalDebits: 67.95, totalCredits: 0, closing: 52.03, exclusionAnchors: ['Transações de Cofres Pessoais e de Grupo'] },
  { file: 'revolut-2026-q3.pdf', templateId: 'revolut-current-account-v1', rows: 48, debits: 41, credits: 7, transactionPages: [1, 2, 3], opening: 19.43, totalDebits: 370.26, totalCredits: 408.78, closing: 57.95, exclusionAnchors: ['Revertido de', 'Transações de Cofres Pessoais e de Grupo'] },
];

type ExclusionEvidence = {
  anchor: string;
  occurrences: Array<{ page: number; y: number }>;
};

const main = async () => {
  const fixtureFlag = process.argv.indexOf('--fixtures');
  assert.notEqual(fixtureFlag, -1, 'Usage: tsx scripts/pdf-import-application-smoke.ts --fixtures <directory>');
  const fixtureRoot = path.resolve(process.argv[fixtureFlag + 1] ?? '');

  const templatesResponse = await GET();
  assert.equal(templatesResponse.status, 200);
  assert.deepEqual(
    (await templatesResponse.json()).map((template: { id: string }) => template.id),
    ['activobank-current-account-v1', 'cgd-current-account-v1', 'revolut-current-account-v1']
  );

  const unsupportedBytes = await readFile(path.join(fixtureRoot, cases[0].file));
  const unsupportedForm = new FormData();
  unsupportedForm.set('templateId', '../../arbitrary-template.json');
  unsupportedForm.set('file', new File([unsupportedBytes], cases[0].file, { type: 'application/pdf' }));
  const unsupportedResponse = await POST(
    new NextRequest('http://localhost/api/pdf-import/extract', { method: 'POST', body: unsupportedForm })
  );
  assert.equal(unsupportedResponse.status, 400);
  assert.equal((await unsupportedResponse.json()).code, 'UNSUPPORTED_TEMPLATE');

  for (const fixture of cases) {
    const bytes = await readFile(path.join(fixtureRoot, fixture.file));
    const form = new FormData();
    form.set('templateId', fixture.templateId);
    form.set('file', new File([bytes], fixture.file, { type: 'application/pdf' }));
    const request = new NextRequest('http://localhost/api/pdf-import/extract', { method: 'POST', body: form });
    const response = await POST(request);
    const body = await response.json() as PdfExtractionReport | { error: string };
    assert.equal(response.status, 200, 'error' in body ? body.error : fixture.file);
    assert.ok(!('error' in body));
    assert.equal(body.template.id, fixture.templateId);
    assert.equal(body.transactionTable.rowCount, fixture.rows);
    assert.equal(body.transactionTable.debitRowCount, fixture.debits);
    assert.equal(body.transactionTable.creditRowCount, fixture.credits);
    assert.deepEqual(body.transactionTable.detectedPages.map((page) => page.page), fixture.transactionPages);
    assert.equal(body.reconciliation.status, 'PASS');
    assert.equal(body.reconciliation.difference, 0);
    assert.equal(body.reconciliation.rowContinuityFailureCount, 0);
    assert.equal(body.reconciliation.openingBalance, fixture.opening);
    assert.equal(body.reconciliation.totalDebits, fixture.totalDebits);
    assert.equal(body.reconciliation.totalCredits, fixture.totalCredits);
    assert.equal(body.reconciliation.calculatedClosingBalance, fixture.closing);
    assert.equal(body.reconciliation.statementClosingBalance, fixture.closing);
    const evidence = (body.scopeDiagnostics.excludedSectionEvidence ?? []) as ExclusionEvidence[];
    for (const anchor of fixture.exclusionAnchors ?? []) {
      const boundary = evidence.find((item) => item.anchor === anchor)?.occurrences[0];
      assert.ok(boundary, `${fixture.file} did not find exclusion anchor ${anchor}`);
      assert.equal(
        body.transactionTable.rows.some(
          (row) => row.page > boundary.page || (row.page === boundary.page && row.source.y >= boundary.y)
        ),
        false,
        `${fixture.file} extracted a row at or after ${anchor}`
      );
    }
    console.log(
      `${fixture.file}: rows=${body.transactionTable.rowCount} debit=${body.transactionTable.debitRowCount} ` +
      `credit=${body.transactionTable.creditRowCount} reconciliation=${body.reconciliation.status} ` +
      `difference=${body.reconciliation.difference?.toFixed(2)}`
    );
  }
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
