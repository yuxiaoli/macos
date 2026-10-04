'use strict';
const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');

async function boot(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.wm && window.workspace && window.menus);
  await expect(page.locator('#dock-finder')).toBeVisible();
  await expect(page.locator('.app-error')).toHaveCount(0);
}
async function menu(page, name, command) {
  await page.locator(`[data-menu="${name}"]`).click();
  if (command) await page.locator(`.desktop-menu > [data-command="${command}"]`).click();
}
async function open(page, app, options = {}) {
  const id = await page.evaluate(({ app, options }) => window.wm.openApp(app, options).id, { app, options });
  await expect(page.locator(`#${id}`)).toBeVisible();
  return page.locator(`#${id}`);
}
async function focus(page, win) {
  await page.evaluate(id => window.wm.focusWindow(id), await win.getAttribute('id'));
}
async function terminal(win, command) {
  await win.locator('.term-input').fill(command);
  await win.locator('.term-input').press('Enter');
  await expect(win.locator('.term-input')).toHaveValue('');
}
async function read(page, path) { return page.evaluate(path => window.fileStore.read(path), path); }
async function windows(page, app) { return page.evaluate(app => window.wm.listWindows().filter(w => w.appId === app).length, app); }
async function canvasData(win) { return win.locator('canvas').evaluate(canvas => canvas.toDataURL()); }
async function draw(page, win) {
  const canvas = win.locator('canvas');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * .4, box.y + box.height * .4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .65, box.y + box.height * .6, { steps: 10 });
  // Releasing outside the canvas must finish, rather than leave a permanent stroke.
  await page.mouse.move(box.x + box.width + 20, box.y + box.height * .6, { steps: 4 });
  await page.mouse.up();
  await expect(win.locator('[data-app-command="undo"]')).toBeEnabled();
  await expect(win.locator('.sketch-status')).toContainText('Draft saved');
}

test('shell and local apps load with third-party requests blocked', async ({ page }) => {
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') { requests.push(url.href); return route.abort(); }
    return route.continue();
  });
  await boot(page);
  for (const app of ['textedit', 'terminal', 'calculator', 'sketch', 'settings', 'trash']) await open(page, app);
  await expect(page.locator('#menubar [data-menu]')).toHaveCount(8);
  await expect(page.locator('#menubar [data-status]')).toHaveCount(5);
  await expect(page.locator('#dock-studio')).toHaveCount(0);
  await expect(page.locator('.app-error')).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
  expect(await page.locator('#dock img').evaluateAll(images => images.every(i => i.complete && i.naturalWidth > 0))).toBe(true);
});

test('all top menus open, disabled file actions stay disabled, keyboard focus returns', async ({ page }) => {
  await boot(page);
  const finder = page.locator('.window[data-app="finder"]');
  const search = finder.locator('.finder-search');
  await search.focus();
  for (const name of ['Apple', 'Application', 'File', 'Edit', 'View', 'Go', 'Window', 'Help']) {
    await menu(page, name);
    await expect(page.locator('.desktop-menu')).toBeVisible();
    await expect(page.locator('.desktop-menu > button')).not.toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('.desktop-menu')).toHaveCount(0);
    await expect(search).toBeFocused();
  }
  await menu(page, 'File');
  for (const command of ['open', 'rename', 'getInfo', 'trash', 'emptyTrash']) {
    await expect(page.locator(`.desktop-menu [data-command="${command}"]`)).toBeDisabled();
  }
  await page.keyboard.press('End');
  await expect(page.locator('.desktop-menu [data-command="close"]')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.locator('.desktop-menu [data-command="newFinder"]')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-menu="Edit"]')).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await menu(page, 'View');
  await page.locator('[data-command="appearance"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.submenu')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
});

test('menus retain the original editor selection and failed Cut never deletes', async ({ page }) => {
  await boot(page);
  const win = await open(page, 'textedit');
  const text = win.locator('.text-area');
  await text.fill('alpha beta gamma');
  await text.evaluate(el => { el.focus(); el.setSelectionRange(6, 10); });
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Permission denied for test'); } } }));
  await menu(page, 'Edit', 'cut');
  await expect(text).toHaveValue('alpha beta gamma');
  await expect(page.locator('#workspace-notice')).toContainText('Clipboard action failed');
  await expect(text).toBeFocused();
  expect(await text.evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual([6, 10]);
  await menu(page, 'Edit', 'selectAll');
  expect(await text.evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual([0, 16]);
});

test('status panels, calendar navigation and Control Center work without fake hardware state', async ({ page, context }) => {
  await boot(page);
  await page.locator('[data-status="battery"]').click();
  await expect(page.locator('.status-panel')).toContainText(/Battery/);
  await expect(page.locator('.status-panel')).toContainText(/unavailable|Charging|On battery/);
  await page.keyboard.press('Escape');
  await page.locator('[data-status="network"]').click();
  await expect(page.locator('.network-state')).toHaveText('Online');
  await context.setOffline(true);
  await expect(page.locator('.network-state')).toHaveText('Offline');
  await context.setOffline(false);
  await page.keyboard.press('Escape');
  await page.locator('[data-status="clock"]').click();
  const original = await page.locator('.calendar-nav strong').textContent();
  await page.getByRole('button', { name: /^Next month/ }).click();
  await expect(page.locator('.calendar-nav strong')).not.toHaveText(original);
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.locator('.calendar-nav strong')).toHaveText(original);
  await page.keyboard.press('Escape');
  await page.locator('[data-status="control"]').click();
  await page.getByLabel('Reduce Motion').check();
  await page.getByLabel('Automatically Hide Dock').check();
  await expect(page.locator('html')).toHaveClass(/reduced-motion/);
  await expect(page.locator('html')).toHaveClass(/dock-auto-hide/);
  await page.keyboard.press('Escape');
  await menu(page, 'File');
  await expect(page.locator('.desktop-menu')).toBeVisible();
});

test('Finder windows navigate independently and sync desktop files and Spotlight', async ({ page }) => {
  await boot(page);
  const first = page.locator('.window[data-app="finder"]').first();
  const second = await open(page, 'finder', { newWindow: true });
  await second.getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(second.locator('.finder-location')).toHaveText('/Documents');
  await expect(first.locator('.finder-location')).toHaveText('/Desktop');
  await focus(page, first);
  await first.getByRole('button', { name: 'New Text File', exact: true }).click();
  await page.locator('dialog input').fill('Shared browser.txt');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.locator('#desktop-files').getByRole('option', { name: 'Shared browser.txt', exact: true })).toBeVisible();
  await page.locator('[data-status="search"]').click();
  await page.getByLabel('Search apps, files and folders').fill('Shared browser');
  await page.locator('.spotlight-results button').click();
  await expect(page.locator('.window[data-app="textedit"] .text-area')).toBeVisible();
  expect(await read(page, ['Desktop', 'Shared browser.txt'])).toMatchObject({ type: 'text', content: '' });
});

test('two TextEdit windows save their own documents and opening a file deduplicates', async ({ page }) => {
  await boot(page);
  const one = await open(page, 'textedit', { path: ['Desktop', 'Welcome.txt'] });
  const two = await open(page, 'textedit', { path: ['Documents', 'notes.txt'] });
  await focus(page, one);
  await one.locator('.text-area').fill('First document');
  await one.locator('.text-area').press('Control+s');
  expect((await read(page, ['Desktop', 'Welcome.txt'])).content).toBe('First document');
  await focus(page, two);
  await two.locator('.text-area').fill('Second document');
  await menu(page, 'File', 'save');
  expect((await read(page, ['Documents', 'notes.txt'])).content).toBe('Second document');
  await page.evaluate(() => workspace.openPath(['Desktop', 'Welcome.txt']));
  expect(await windows(page, 'textedit')).toBe(2);
  await expect(one).not.toHaveClass(/inactive/);
  await one.locator('.close-btn').click();
  expect(await windows(page, 'textedit')).toBe(1);
  await expect(two.locator('.text-area')).toHaveValue('Second document');
});

test('New/Save shortcuts fire once and native dialogs trap focus and cancel safely', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Control+n');
  expect(await windows(page, 'finder')).toBe(2);
  const editor = await open(page, 'textedit');
  await editor.locator('.text-area').fill('An unsaved draft');
  await editor.locator('.text-area').press('Control+s');
  await expect(page.locator('dialog')).toHaveCount(1);
  await expect(page.locator('dialog')).toContainText('Save Text Document');
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('dialog'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog')).toHaveCount(0);
  await editor.locator('.close-btn').click();
  await expect(page.locator('dialog')).toContainText('Save your changes?');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editor.locator('.text-area')).toHaveValue('An unsaved draft');
});

test('folder rename follows open windows and cancelling a multi-draft delete preserves all drafts', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { fileStore.create(['Desktop', 'Project'], 'one.txt', 'text', 'one'); fileStore.create(['Desktop', 'Project'], 'two.txt', 'text', 'two'); });
  const finder = await open(page, 'finder', { path: ['Desktop', 'Project'], newWindow: true });
  const one = await open(page, 'textedit', { path: ['Desktop', 'Project', 'one.txt'] });
  const two = await open(page, 'textedit', { path: ['Desktop', 'Project', 'two.txt'] });
  await page.evaluate(() => fileStore.rename(['Desktop', 'Project'], 'Renamed'));
  await expect(finder.locator('.finder-location')).toHaveText('/Desktop/Renamed');
  await focus(page, one); await one.locator('.text-area').fill('dirty one');
  await focus(page, two); await two.locator('.text-area').fill('dirty two');
  await page.evaluate(() => { void workspace.requestTrash(['Desktop', 'Renamed']); });
  await expect(page.locator('dialog')).toContainText('one.txt');
  await page.getByRole('button', { name: 'Discard Changes', exact: true }).click();
  await expect(page.locator('dialog')).toContainText('two.txt');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(one.locator('.text-area')).toHaveValue('dirty one');
  await expect(two.locator('.text-area')).toHaveValue('dirty two');
  expect((await read(page, ['Desktop', 'Renamed'])).type).toBe('folder');
  expect(await page.evaluate(() => fileStore.listTrash().length)).toBe(0);
});

test('Terminal windows stay independent and external writes update clean editors but retain dirty drafts', async ({ page }) => {
  await boot(page);
  const editor = await open(page, 'textedit', { path: ['Documents', 'notes.txt'] });
  const one = await open(page, 'terminal', { newWindow: true });
  const two = await open(page, 'terminal', { newWindow: true });
  await terminal(two, 'cd /Downloads');
  await focus(page, one); await terminal(one, 'cd /Documents');
  await terminal(one, 'echo clean > notes.txt');
  await expect(editor.locator('.text-area')).toHaveValue('clean\n');
  await expect(two.locator('.term-prompt')).toContainText('/Downloads');
  await focus(page, editor); await editor.locator('.text-area').fill('keep this draft');
  await focus(page, one); await terminal(one, 'echo outside > notes.txt');
  await expect(editor.locator('.text-area')).toHaveValue('keep this draft');
  await expect(editor.locator('.text-status')).toContainText(/changed|conflict/i);
  expect((await read(page, ['Documents', 'notes.txt'])).content).toBe('outside\n');
});

test('Trash needs explicit confirmation, supports restore and permanently empties after approval', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => fileStore.trash(['Desktop', 'Welcome.txt']));
  const trash = await open(page, 'trash');
  await expect(trash.getByRole('option', { name: 'Welcome.txt', exact: true })).toBeVisible();
  await trash.getByRole('option', { name: 'Welcome.txt', exact: true }).click();
  await menu(page, 'File', 'restore');
  expect((await read(page, ['Desktop', 'Welcome.txt'])).type).toBe('text');
  await page.evaluate(() => fileStore.trash(['Desktop', 'Welcome.txt']));
  await focus(page, trash); await menu(page, 'File', 'emptyTrash');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(() => fileStore.listTrash().length)).toBe(1);
  await menu(page, 'File', 'emptyTrash');
  await page.getByRole('button', { name: 'Empty Trash', exact: true }).click();
  expect(await page.evaluate(() => fileStore.listTrash().length)).toBe(0);
});

test('quota failure keeps saved content and dirty text, stale tabs cannot overwrite', async ({ page, context }) => {
  await boot(page);
  const editor = await open(page, 'textedit', { path: ['Documents', 'notes.txt'] });
  await editor.locator('.text-area').fill('quota protected');
  await page.evaluate(() => { window.originalStorage = fileStore._storage; fileStore._storage = { getItem: key => originalStorage.getItem(key), setItem: () => { throw new DOMException('Test quota full', 'QuotaExceededError'); } }; });
  await menu(page, 'File', 'save');
  await expect(editor.locator('.text-status')).toContainText(/full|quota/i);
  expect((await read(page, ['Documents', 'notes.txt'])).content).not.toBe('quota protected');
  await page.evaluate(() => { fileStore._storage = originalStorage; });
  const other = await context.newPage(); await boot(other);
  await other.evaluate(() => fileStore.write(['Documents', 'notes.txt'], 'newer other tab'));
  await focus(page, editor); await menu(page, 'File', 'save');
  await expect(editor.locator('.text-area')).toHaveValue('quota protected');
  await expect(editor.locator('.text-status')).toContainText(/another tab|reload|conflict|changed/i);
  expect((await read(other, ['Documents', 'notes.txt'])).content).toBe('newer other tab');
});

test('damaged v1 storage stays intact and presents disabled mutating commands', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('macos.web.filesystem.v1', '{not valid json'));
  await boot(page);
  await menu(page, 'File');
  for (const command of ['newFolder', 'newText', 'emptyTrash']) await expect(page.locator(`.desktop-menu [data-command="${command}"]`)).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem('macos.web.filesystem.v1'))).toBe('{not valid json');
  expect(await page.evaluate(() => fileStore.readOnly)).toBe(true);
});

test('real pointer drag/resize, minimize, overview and Show Desktop preserve windows', async ({ page }) => {
  await boot(page);
  const win = page.locator('.window[data-app="finder"]');
  const before = await win.boundingBox(), header = await win.locator('.window-header').boundingBox();
  await page.mouse.move(header.x + header.width * .6, header.y + header.height / 2);
  await page.mouse.down(); await page.mouse.move(header.x + header.width * .6 + 100, header.y + header.height / 2 + 80, { steps: 10 }); await page.mouse.up();
  const dragged = await win.boundingBox();
  expect(dragged.x).toBeGreaterThan(before.x + 50); expect(dragged.y).toBeGreaterThan(before.y + 40);
  const handle = await win.locator('.resize-se').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down(); await page.mouse.move(handle.x + 75, handle.y + 60, { steps: 10 }); await page.mouse.up();
  const resized = await win.boundingBox(); expect(resized.width).toBeGreaterThan(dragged.width + 30);
  await win.locator('.min-btn').click(); await expect(win).not.toBeVisible();
  await page.keyboard.press('F3'); await expect(page.locator('.window-overview')).toBeVisible();
  await page.locator('.overview-card').click(); await expect(win).toBeVisible();
  await menu(page, 'View', 'showDesktop'); await expect(page.locator('#windows-container')).toHaveClass(/show-desktop/);
  await menu(page, 'View', 'showDesktop'); await expect(page.locator('#windows-container')).not.toHaveClass(/show-desktop/);
  await page.setViewportSize({ width: 720, height: 520 });
  const small = await win.boundingBox(); expect(small.x).toBeGreaterThanOrEqual(0); expect(small.y).toBeGreaterThanOrEqual(28); expect(small.x + small.width).toBeLessThanOrEqual(721);
  await expect(win.locator('.close-btn')).toBeInViewport();
});

test('saved workspace and settings restore, unsaved untitled drafts do not', async ({ page }) => {
  await boot(page);
  const saved = await open(page, 'textedit', { path: ['Documents', 'notes.txt'] });
  await saved.locator('.text-area').fill('Saved before reload'); await menu(page, 'File', 'save');
  const draft = await open(page, 'textedit', { newWindow: true }); await draft.locator('.text-area').fill('Do not restore this');
  await page.evaluate(() => { wm.updateSettings({ appearance: 'light', clock24: true, reducedMotion: true }); const r = wm.listWindows().find(w => w.appId === 'finder'); r.controller.navigate(['Downloads']); wm.minimizeWindow(r.id); wm.saveSession(); });
  page.once('dialog', dialog => dialog.accept());
  await page.reload(); await page.waitForFunction(() => window.wm && window.workspace);
  expect(await windows(page, 'textedit')).toBe(1);
  await expect(page.locator('.text-area')).toHaveValue('Saved before reload');
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
  expect(await page.evaluate(() => wm.settings.clock24)).toBe(true);
  expect(await page.evaluate(() => { const w = wm.listWindows().find(w => w.appId === 'finder'); return { path: w.controller.path, minimized: w.minimized }; })).toEqual({ path: ['Downloads'], minimized: true });
});

test('Calculator supports stepwise arithmetic, repeated equals, decimals, sign, percent and error recovery', async ({ page }) => {
  await boot(page);
  const win = await open(page, 'calculator');
  const panel = win.locator('.mac-calculator'), display = win.locator('.calculator-display');
  await panel.focus(); await page.keyboard.type('2+3*4'); await page.keyboard.press('Enter'); await expect(display).toHaveText('20');
  await page.keyboard.press('Enter'); await expect(display).toHaveText('80');
  await win.locator('[data-calc-key="clear"]').click(); await page.keyboard.type('0.1+0.2'); await page.keyboard.press('Enter'); await expect(display).toHaveText('0.3');
  await win.locator('[data-calc-key="sign"]').click(); await expect(display).toHaveText('-0.3');
  await win.locator('[data-calc-key="percent"]').click(); await expect(display).toHaveText('-0.003');
  await win.locator('[data-calc-key="clear"]').click(); await page.keyboard.type('8/0'); await page.keyboard.press('Enter'); await expect(display).toHaveText('Error');
  await page.keyboard.type('7'); await expect(display).toHaveText('7');
  await win.locator('.min-btn').click(); await page.locator('#dock-calculator').click(); await expect(display).toHaveText('7');
});

test('Sketch pointer release, undo/redo, resize, PNG round trip and draft reload preserve the document', async ({ page }, testInfo) => {
  await boot(page);
  const win = await open(page, 'sketch');
  await page.evaluate(async () => { await wm.listWindows().find(w => w.appId === 'sketch').controller.ready; });
  const blank = await canvasData(win);
  await draw(page, win); const drawn = await canvasData(win); expect(drawn).not.toBe(blank);
  await win.locator('[data-app-command="undo"]').click(); expect(await canvasData(win)).toBe(blank);
  await win.locator('[data-app-command="redo"]').click(); expect(await canvasData(win)).toBe(drawn);
  await win.locator('.max-btn').click(); expect(await canvasData(win)).toBe(drawn);
  const downloading = page.waitForEvent('download'); await win.locator('[data-app-command="exportPNG"]').click();
  const download = await downloading, output = testInfo.outputPath('Sketch.png'); await download.saveAs(output);
  const bytes = await fs.readFile(output); expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); expect(bytes.readUInt32BE(16)).toBe(1024); expect(bytes.readUInt32BE(20)).toBe(768);
  await win.locator('[data-app-command="clear"]').click(); expect(await canvasData(win)).toBe(blank);
  await win.locator('.sketch-import-input').setInputFiles(output);
  await expect.poll(() => canvasData(win)).toBe(drawn);
  await expect(win.locator('.sketch-status')).toContainText('Draft saved');
  await page.evaluate(() => wm.saveSession()); await page.reload(); await page.waitForFunction(() => window.wm);
  await page.evaluate(async () => { await wm.listWindows().find(w => w.appId === 'sketch').controller.ready; });
  expect(await canvasData(page.locator('.window[data-app="sketch"]'))).toBe(drawn);
});

test('Safari uses configured Home, tracks its own history, rejects unsafe addresses and exposes external fallback', async ({ page }) => {
  await page.route('https://vectorindex.cloud/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Homepage test fixture</h1>' }));
  await page.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Navigation test fixture</h1>' }));
  await boot(page); const win = await open(page, 'safari'), address = win.locator('.safari-address-input');
  await expect(address).toHaveValue('https://vectorindex.cloud/');
  await expect(win.locator('.safari-external')).toBeVisible();
  await address.fill('javascript:alert(1)'); await address.press('Enter');
  await expect(win.locator('.safari-webview')).toHaveAttribute('src', 'https://vectorindex.cloud/');
  await expect(page.locator('#workspace-notice')).toContainText(/HTTP|address|allowed/i);
  await address.fill('https://example.com/'); await address.press('Enter');
  await expect(win.locator('.safari-webview')).toHaveAttribute('src', 'https://example.com/');
  await win.locator('[data-app-command="back"]').click(); await expect(address).toHaveValue('https://vectorindex.cloud/');
  await win.locator('[data-app-command="forward"]').click(); await expect(address).toHaveValue('https://example.com/');
  await win.locator('[data-app-command="home"]').click(); await expect(address).toHaveValue('https://vectorindex.cloud/');
  await expect(win.locator('.safari-status')).toContainText(/cannot|could not|unverified|verified|Externally|appear/i);
});

test('desktop-only menus disable window commands and local Help dialogs are usable', async ({ page }) => {
  await boot(page);
  await page.locator('.window .close-btn').click();
  await expect(page.locator('.window')).toHaveCount(0);
  await menu(page, 'Window');
  await expect(page.locator('.desktop-menu [data-command="minimize"]')).toBeDisabled();
  await expect(page.locator('.desktop-menu [data-command="maximize"]')).toBeDisabled();
  await page.keyboard.press('Escape');
  for (const title of ['Desktop Guide', 'Keyboard Shortcuts', 'Storage & Browser Capabilities']) {
    await menu(page, 'Help'); await page.locator('.desktop-menu button').filter({ hasText: title }).click();
    await expect(page.getByRole('dialog')).toContainText(title);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
  }
  await menu(page, 'Apple', 'settings'); await expect(page.locator('.window[data-app="settings"]')).toBeVisible();
});

test('opening a modal interrupts a window pointer gesture safely', async ({ page }) => {
  await boot(page);
  const win = page.locator('.window[data-app="finder"]'), header = await win.locator('.window-header').boundingBox();
  await page.mouse.move(header.x + 400, header.y + 20); await page.mouse.down();
  await page.mouse.move(header.x + 440, header.y + 60, { steps: 3 });
  await page.evaluate(() => { void workspace.dialog('Pointer interruption test', 'The background must stop moving while this dialog is open.', null, [{ label: 'Close', value: true }]); });
  await expect(page.locator('dialog')).toBeVisible();
  const before = await win.boundingBox();
  await page.mouse.move(header.x + 550, header.y + 160, { steps: 5 }); await page.mouse.up();
  const during = await win.boundingBox();
  expect(during).toEqual(before);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('html')).not.toHaveClass(/window-gesture/);
  await page.mouse.move(header.x + 600, header.y + 210);
  expect(await win.boundingBox()).toEqual(during);
});

test('Calculator clean close/reopen and Sketch replacement Cancel preserve consistent state', async ({ page }) => {
  await boot(page);
  const calculator = await open(page, 'calculator');
  await calculator.locator('.mac-calculator').focus(); await page.keyboard.type('5+2'); await page.keyboard.press('Enter');
  await expect(calculator.locator('.calculator-display')).toHaveText('7');
  await calculator.locator('.close-btn').click();
  const reopened = await open(page, 'calculator'); await expect(reopened.locator('.calculator-display')).toHaveText('0');
  await reopened.locator('.mac-calculator').focus(); await page.keyboard.type('3'); await page.keyboard.press('Enter'); await expect(reopened.locator('.calculator-display')).toHaveText('3');
  const sketch = await open(page, 'sketch'); await page.evaluate(async () => { await wm.listWindows().find(w => w.appId === 'sketch').controller.ready; });
  await draw(page, sketch); const before = await canvasData(sketch);
  await menu(page, 'File', 'newDrawing'); await expect(page.locator('dialog')).toContainText('Start a new drawing?');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); expect(await canvasData(sketch)).toBe(before);
});

test('switching to a Finder title never lets Edit target an older TextEdit field', async ({ page }) => {
  await boot(page);
  const finder = page.locator('.window[data-app="finder"]').first();
  const editor = await open(page, 'textedit', { newWindow: true });
  await editor.locator('.text-area').fill('Protected in the other window');
  await editor.locator('.text-area').evaluate(el => { el.focus(); el.select(); });
  await page.evaluate(id => wm.focusWindow(id, false), await finder.getAttribute('id'));
  await menu(page, 'Edit');
  await expect(page.locator('.desktop-menu [data-command="cut"]')).toBeDisabled();
  await expect(editor.locator('.text-area')).toHaveValue('Protected in the other window');
  await page.keyboard.press('Escape');
  await page.evaluate(async () => { await workspace.openPath(['Desktop', 'Project']); await workspace.openPath(['Documents']); });
  expect(await windows(page, 'finder')).toBe(1);
});

test('Terminal entry has no form outline and wraps long commands safely in a narrow window', async ({ page }) => {
  await boot(page);
  const terminalWindow = await open(page, 'terminal');
  const input = terminalWindow.locator('.term-input');
  await input.focus();
  expect(await input.evaluate(el => ({ tag: el.tagName, outline: getComputedStyle(el).outlineStyle, weight: getComputedStyle(el).fontWeight }))).toEqual({ tag: 'TEXTAREA', outline: 'none', weight: '400' });
  await page.setViewportSize({ width: 480, height: 620 });
  const longFolder = 'A long working folder name '.repeat(3).trim();
  await page.evaluate(name => fileStore.create(['Documents'], name, 'folder'), longFolder);
  await terminal(terminalWindow, 'cd "/Documents/' + longFolder + '"');
  await expect(terminalWindow.locator('.term-prompt')).toContainText(longFolder);
  const longCommand = 'echo "' + 'readable wrapped command '.repeat(20) + '"';
  await input.fill(longCommand);
  await expect.poll(() => input.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(36);
  expect(await input.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await input.evaluate(el => el.scrollHeight <= el.clientHeight + 2)).toBe(true);
  await input.press('Enter');
  await expect(terminalWindow.locator('.term-history')).toContainText('readable wrapped command');
  await input.press('ArrowUp'); await expect(input).toHaveValue(longCommand);
  await input.press('ArrowDown'); await expect(input).toHaveValue('');
  const pasted = 'echo first\nmkdir /Documents/not-created-by-paste';
  await input.fill(pasted); await input.press('Enter');
  expect(await page.evaluate(() => { try { fileStore.read(['Documents', 'not-created-by-paste']); return true; } catch (_) { return false; } })).toBe(false);
  await input.press('ArrowUp'); await expect(input).toHaveValue(pasted);
  const box = await terminalWindow.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(481);
});

test('Calculator long results stay on one line and every key fits the compact window', async ({ page }) => {
  await boot(page);
  const calculator = await open(page, 'calculator');
  await calculator.locator('.mac-calculator').focus();
  await page.keyboard.type('123456789012345');
  await expect(calculator.locator('.calculator-display')).toHaveText('123456789012345');
  const sizes = await calculator.evaluate(el => {
    const outer = el.getBoundingClientRect();
    const display = el.querySelector('.calculator-display'), range = document.createRange();
    range.selectNodeContents(display);
    return { lines: new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size,
      keysInside: [...el.querySelectorAll('.calculator-key')].every(key => { const rect = key.getBoundingClientRect(); return rect.top >= outer.top && rect.bottom <= outer.bottom + 1 && rect.right <= outer.right + 1; }),
      displayFits: display.scrollWidth <= display.clientWidth + 1 };
  });
  expect(sizes).toEqual({ lines: 1, keysInside: true, displayFits: true });
  const smallFont = await calculator.locator('.calculator-display').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  await page.evaluate(id => { const record = wm.windows[id]; record.bounds.width = 400; wm.applyBounds(record); }, await calculator.getAttribute('id'));
  await expect.poll(() => calculator.locator('.calculator-display').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(smallFont);
  await page.evaluate(id => { const record = wm.windows[id]; record.bounds.width = 280; wm.applyBounds(record); }, await calculator.getAttribute('id'));
  expect(await calculator.locator('.calculator-display').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await calculator.locator('[data-calc-key="clear"]').click();
  await expect(calculator.locator('.calculator-display')).toHaveText('0');
});

test('Settings switches remain keyboard-operable and update the saved preference', async ({ page }) => {
  await boot(page);
  const settings = await open(page, 'settings');
  const reduce = settings.getByRole('switch', { name: /reduce motion/i });
  await expect(reduce).not.toBeChecked();
  await reduce.focus(); await reduce.press('Space');
  await expect(reduce).toBeChecked();
  await expect(page.locator('html')).toHaveClass(/reduced-motion/);
  await reduce.press('Space');
  await expect(reduce).not.toBeChecked();
  await expect(page.locator('html')).not.toHaveClass(/reduced-motion/);
});
