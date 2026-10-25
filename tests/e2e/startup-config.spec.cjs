'use strict';
const {test, expect} = require('@playwright/test');
const configure = apps => '/?config=' + encodeURIComponent(JSON.stringify({version:1, apps}));

test('configured apps and Safari home preserve the normal workspace and edited notes', async ({page}) => {
  await page.route('https://configured.example/**', route => route.fulfill({contentType:'text/html', body:'<h1>Configured home</h1>'}));
  await page.route('https://another.example/**', route => route.fulfill({contentType:'text/html', body:'<h1>Another page</h1>'}));
  await page.goto('/');
  await page.waitForFunction(() => window.wm && window.workspace);
  const saved = await page.evaluate(() => {
    window.fileStore.write(['Documents','notes.txt'], 'My saved notes, unchanged.');
    window.wm.updateSettings({appearance:'light'});
    window.wm.openApp('terminal', {newWindow:true});
    window.wm.saveSession();
    return Object.fromEntries(['macos.web.filesystem.v1','macos.web.settings.v1','macos.web.session.v1'].map(key => [key,localStorage.getItem(key)]));
  });
  await page.goto(configure({safari:{homepage:'https://configured.example/home'}, textedit:{}, calculator:{}}));
  await expect(page.locator('#workspace-notice')).toContainText('Temporary startup configuration');
  await expect(page.locator('#dock [data-app]')).toHaveCount(3);
  await expect(page.locator('#dock-terminal')).toHaveCount(0);
  await expect(page.locator('.window[data-app=terminal]')).toHaveCount(0);
  await page.locator('[data-status=control]').click();
  await expect(page.getByRole('button',{name:/System Settings/})).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.locator('#dock-safari').click();
  await expect(page.locator('.safari-address-input')).toHaveValue('https://configured.example/home');
  await expect(page.frameLocator('.safari-webview').getByRole('heading')).toHaveText('Configured home');
  await page.locator('.safari-address-input').fill('https://another.example/page');
  await page.locator('.safari-address-input').press('Enter');
  await expect(page.frameLocator('.safari-webview').getByRole('heading')).toHaveText('Another page');
  await page.locator('[data-app-command=home]').click();
  await expect(page.locator('.safari-address-input')).toHaveValue('https://configured.example/home');
  await expect(page.locator('.safari-external')).toHaveAttribute('href','https://configured.example/home');
  await expect(page.locator('.safari-bookmarks a')).toHaveCount(3);
  await page.locator('#dock-textedit').click();
  await expect(page.locator('.text-area')).toHaveValue('My saved notes, unchanged.');
  await page.evaluate(() => {window.wm.updateSettings({appearance:'dark'});window.wm.saveSession();});
  expect(await page.evaluate(keys => Object.fromEntries(keys.map(key => [key,localStorage.getItem(key)])), Object.keys(saved))).toEqual(saved);
  await page.goto('/');
  await expect(page.locator('#dock [data-app]')).toHaveCount(8);
  await expect(page.locator('.window[data-app=terminal]')).toHaveCount(1);
  expect(await page.evaluate(() => window.wm.settings.appearance)).toBe('light');
  expect(await page.evaluate(() => window.fileStore.read(['Documents','notes.txt']).content)).toBe('My saved notes, unchanged.');
});

test('invalid config falls back visibly; an explicit empty allowlist enables no apps without deleting files', async ({page}) => {
  await page.goto('/?config=' + encodeURIComponent(JSON.stringify({version:1,apps:{safari:{homepage:'javascript:alert(1)'}}})));
  await expect(page.locator('#dock [data-app]')).toHaveCount(8);
  await expect(page.locator('#workspace-notice')).toContainText('configuration was ignored');
  expect(await page.evaluate(() => window.wm.openApp('calculator').appId)).toBe('calculator');
  await page.goto(configure({}));
  await expect(page.locator('#workspace-notice')).toContainText('Temporary startup configuration');
  await expect(page.locator('#dock [data-app]')).toHaveCount(0);
  await expect(page.locator('.window')).toHaveCount(0);
  expect(await page.evaluate(() => window.fileStore.read(['Documents','notes.txt']).type)).toBe('text');
  await page.evaluate(() => window.workspace.openPath(['Documents','notes.txt']));
  await expect(page.locator('#workspace-notice')).toContainText('TextEdit is not enabled');
});
