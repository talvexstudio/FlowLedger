import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argument = name => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};
const baseUrl = argument('--base-url') ?? 'http://127.0.0.1:3131';
const fixture = path.resolve(argument('--fixture') ?? '');
const templateLabel = argument('--template-label') ?? 'ActivoBank Current Account';
const accountLabel = argument('--account-label') ?? 'Household Checking';
if (!fs.existsSync(fixture)) throw new Error('A valid --fixture PDF path is required');

const browserPath = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(fs.existsSync);
if (!browserPath) throw new Error('No Chromium browser found');

const debuggingPort = 9234;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowledger-pdf-ui-'));
const browser = spawn(browserPath, [
  '--headless=new',
  '--disable-gpu',
  '--disable-crash-reporter',
  '--disable-background-networking',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${debuggingPort}`,
  `--user-data-dir=${profileDir}`,
  `${baseUrl}/import`,
], { stdio: 'ignore' });

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitForTarget() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${debuggingPort}/json/list`).then(response => response.json());
      const target = targets.find(item => item.type === 'page' && item.url.includes('/import'));
      if (target) return target;
    } catch {}
    await delay(250);
  }
  throw new Error('Timed out waiting for the Import page');
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.eventWaiters = new Map();
    this.socket = new WebSocket(url);
    this.socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (!message.id && message.method) {
        const waiters = this.eventWaiters.get(message.method) ?? [];
        this.eventWaiters.delete(message.method);
        waiters.forEach(resolve => resolve(message.params));
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    };
  }
  async ready() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = reject;
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  waitForEvent(method) {
    return new Promise(resolve => {
      const waiters = this.eventWaiters.get(method) ?? [];
      waiters.push(resolve);
      this.eventWaiters.set(method, waiters);
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  }
}

const clickSelectOption = async (client, triggerLabel, label) => {
  await client.evaluate(`(() => {
    const fieldLabel = [...document.querySelectorAll('label')]
      .find(element => element.innerText.trim() === ${JSON.stringify(triggerLabel)});
    const trigger = fieldLabel?.parentElement?.querySelector('[role="combobox"]');
    if (!trigger) throw new Error('Select trigger not found: ${triggerLabel}');
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
    return true;
  })()`);
  let selected = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await delay(100);
    selected = await client.evaluate(`(() => {
      const option = [...document.querySelectorAll('[role="option"]')]
        .find(element => element.innerText.trim() === ${JSON.stringify(label)});
      if (!option) return false;
      option.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
      option.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' }));
      return true;
    })()`);
    if (selected) break;
  }
  if (!selected) throw new Error(`Select option not found: ${label}`);
  await delay(250);
};

let client;
try {
  const target = await waitForTarget();
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.ready();
  await client.send('Runtime.enable');

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await client.evaluate(`document.body?.innerText.includes('Import Transactions') ?? false`)) break;
    await delay(250);
  }
  await delay(2500);
  const fixtureBase64 = fs.readFileSync(fixture).toString('base64');
  const dropped = await client.evaluate(`(async () => {
    const binary = atob(${JSON.stringify(fixtureBase64)});
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const file = new File([bytes], ${JSON.stringify(path.basename(fixture))}, { type: 'application/pdf' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const target = document.querySelector('input[type="file"]')?.closest('label');
    if (!target) return false;
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    return true;
  })()`);
  if (!dropped) throw new Error('Could not dispatch the PDF drop event');

  let pdfControlsReady = false;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    pdfControlsReady = await client.evaluate(`document.body.innerText.includes('Statement format detected') && document.body.innerText.includes(${JSON.stringify(templateLabel)})`);
    if (pdfControlsReady) break;
    await delay(250);
  }
  if (!pdfControlsReady) {
    const diagnostics = await client.evaluate(`({
      fileName: document.querySelector('input[type="file"]')?.files?.[0]?.name ?? null,
      body: document.body.innerText.slice(0, 2500),
    })`);
    throw new Error(`PDF extraction controls did not render after file selection: ${JSON.stringify(diagnostics)}`);
  }
  await clickSelectOption(client, 'Target account', accountLabel);

  let passed = false;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    passed = await client.evaluate(`document.body.innerText.includes('Reconciliation: PASS') && document.body.innerText.includes('75 transactions')`);
    if (passed) break;
    await delay(250);
  }
  if (!passed) throw new Error('PDF extraction preview did not reach reconciliation PASS');

  const result = await client.evaluate(`(() => {
    const importButton = [...document.querySelectorAll('button')]
      .find(element => element.innerText.trim() === 'Import Transactions');
    return {
      reconciliationPass: document.body.innerText.includes('Reconciliation: PASS'),
      parserDetected: document.body.innerText.includes(${JSON.stringify(templateLabel)}),
      transactionCount: document.body.innerText.includes('75 transactions'),
      firstKnownRow: document.body.innerText.includes('TRF. P/O IGCP Encargos da Divida PAG IGCP'),
      mappingHidden: !document.body.innerText.includes('Column Mapping'),
      saveTemplateHidden: !document.body.innerText.includes('Save this mapping as a template'),
      importEnabled: Boolean(importButton) && !importButton.disabled,
      selectedValues: [...document.querySelectorAll('[role="combobox"]')].map(element => element.innerText),
    };
  })()`);
  if (Object.entries(result).some(([key, value]) => key !== 'selectedValues' && value !== true)) {
    throw new Error(`PDF Import UI smoke failed: ${JSON.stringify(result)}`);
  }
  console.log('PASS PDF file -> automatic parser detection -> account -> reconciliation -> preview');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await client?.send('Browser.close').catch(() => {});
  client?.socket.close();
  browser.kill();
  if (browser.exitCode === null) {
    await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(3000)]);
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 39) throw error;
      await delay(500);
    }
  }
}
