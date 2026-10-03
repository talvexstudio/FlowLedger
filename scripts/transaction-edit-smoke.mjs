import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const chromePaths = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const browserPath = chromePaths.find(fs.existsSync);
if (!browserPath) throw new Error('No Chromium browser found');

const port = 9233;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowledger-cdp-'));
const browser = spawn(browserPath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  'http://127.0.0.1:3131/transactions',
], { stdio: 'ignore' });

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForTarget() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
      const target = targets.find(item => item.type === 'page' && item.url.includes('/transactions'));
      if (target) return target;
    } catch {}
    await delay(250);
  }
  throw new Error('Timed out waiting for Chromium target');
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
    this.socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
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

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
}

let client;
try {
  const target = await waitForTarget();
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.ready();
  await client.send('Runtime.enable');

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = await client.evaluate(`document.body?.innerText.includes('Monthly Rent') ?? false`);
    if (ready) break;
    await delay(250);
  }

  const rowBeforeClick = await client.evaluate(`(() => {
    const row = [...document.querySelectorAll('tr')].find(element => element.innerText.includes('Monthly Rent'));
    if (!row) return null;
    return {
      text: row.innerText,
      buttons: [...row.querySelectorAll('button')].map(button => ({
        text: button.innerText,
        ariaLabel: button.getAttribute('aria-label'),
        ariaHasPopup: button.getAttribute('aria-haspopup'),
      })),
    };
  })()`);
  if (!rowBeforeClick) throw new Error('Monthly Rent row was not rendered');

  await client.evaluate(`(() => {
    const row = [...document.querySelectorAll('tr')].find(element => element.innerText.includes('Monthly Rent'));
    const button = row ? [...row.querySelectorAll('button')].at(-1) : null;
    if (!button) return false;
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
    return button.getAttribute('aria-expanded');
  })()`);
  await delay(500);

  const menu = await client.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].map(element => element.innerText)`);
  if (!menu.includes('Edit')) throw new Error('Monthly Rent Edit action was not rendered');

  await client.evaluate(`(() => {
    const edit = [...document.querySelectorAll('[role="menuitem"]')]
      .find(element => element.innerText.trim() === 'Edit');
    if (!edit) return false;
    edit.click();
    return true;
  })()`);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const hydrated = await client.evaluate(`(() => {
      const editHeading = [...document.querySelectorAll('h1,h2,h3')]
        .find(element => element.innerText.includes('Edit Transaction'));
      const container = editHeading?.closest('.fixed');
      const values = container ? [...container.querySelectorAll('[role="combobox"]')].map(element => element.innerText) : [];
      return values.includes('Household Checking') && values.includes('Housing') && values.includes('Rent');
    })()`);
    if (hydrated) break;
    await delay(250);
  }

  const result = await client.evaluate(`(() => {
    const editHeading = [...document.querySelectorAll('h1,h2,h3')]
      .find(element => element.innerText.includes('Edit Transaction'));
    const container = editHeading?.closest('.fixed') ?? document.body;
    return {
      heading: editHeading?.innerText ?? null,
      selects: [...container.querySelectorAll('[role="combobox"]')].map((element, index) => ({
        index,
        text: element.innerText,
        value: element.getAttribute('value'),
        dataState: element.getAttribute('data-state'),
      })),
      labels: [...container.querySelectorAll('label')].map(element => element.innerText),
    };
  })()`);
  const renderedValues = result.selects.map(select => select.text);
  const expectedValues = ['Household Checking', 'Expense', 'Housing', 'Rent'];
  if (
    result.heading !== 'Edit Transaction' ||
    expectedValues.some((value, index) => renderedValues[index] !== value) ||
    !result.labels.includes('Subcategory')
  ) {
    throw new Error(`Transaction edit hydration failed: ${JSON.stringify(result)}`);
  }
  console.log('PASS transaction table -> edit form hydration');
  console.log(JSON.stringify({ renderedValues, labels: result.labels }, null, 2));

  await client.evaluate(`(() => {
    const cancel = [...document.querySelectorAll('button')]
      .find(element => element.innerText.trim() === 'Cancel');
    if (!cancel) throw new Error('Cancel button not found');
    cancel.click();
    return true;
  })()`);
  await delay(250);
  await client.evaluate(`(() => {
    const add = [...document.querySelectorAll('button')]
      .find(element => element.innerText.includes('New Transaction'));
    if (!add) throw new Error('New Transaction button not found');
    add.click();
    return true;
  })()`);

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const ready = await client.evaluate(`document.body.innerText.includes('New Transaction')`);
    if (ready) break;
    await delay(100);
  }

  await client.evaluate(`(() => {
    const heading = [...document.querySelectorAll('h1,h2,h3')]
      .find(element => element.innerText.includes('New Transaction'));
    const trigger = heading?.closest('.fixed')?.querySelector('[role="combobox"]');
    if (!trigger) throw new Error('Create Account trigger not found');
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
    return true;
  })()`);
  await delay(200);
  await client.evaluate(`(() => {
    const option = [...document.querySelectorAll('[role="option"]')]
      .find(element => element.innerText.trim() === 'Personal Savings');
    if (!option) throw new Error('Personal Savings option not found');
    option.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
    option.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' }));
    return true;
  })()`);
  await delay(250);

  const createAccount = await client.evaluate(`(() => {
    const heading = [...document.querySelectorAll('h1,h2,h3')]
      .find(element => element.innerText.includes('New Transaction'));
    const values = [...(heading?.closest('.fixed')?.querySelectorAll('[role="combobox"]') ?? [])]
      .map(element => element.innerText);
    return values[0] ?? null;
  })()`);
  if (createAccount !== 'Personal Savings') {
    throw new Error(`Create account selection was overwritten: ${createAccount}`);
  }
  console.log('PASS create-mode manual account selection remains Personal Savings');
} finally {
  await client?.send('Browser.close').catch(() => {});
  client?.socket.close();
  browser.kill();
  if (browser.exitCode === null) {
    await Promise.race([
      new Promise(resolve => browser.once('exit', resolve)),
      delay(3000),
    ]);
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 19) throw error;
      await delay(500);
    }
  }
}
