'use strict';
// Optional live-network/visual smoke probe; screenshots/reports stay in ignored test-results.
const { firefox } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const output = path.resolve('test-results/visual-probe'); await fs.mkdir(output, { recursive: true });
  const server = spawn(process.execPath, ['scripts/serve.cjs'], { env: { ...process.env, PORT: '3101' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  try {
    await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); });
    browser = await firefox.launch(); const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], network = []; page.on('pageerror', e => errors.push(e.message));
    page.on('response', async response => {
      if (new URL(response.url()).hostname === 'vectorindex.cloud' && response.request().isNavigationRequest()) {
        const headers = await response.allHeaders();
        network.push({ event: 'response', url: response.url(), status: response.status(), contentSecurityPolicy: headers['content-security-policy'] || null, xFrameOptions: headers['x-frame-options'] || null });
      }
    });
    page.on('requestfailed', request => { if (request.url().startsWith('https://vectorindex.cloud')) network.push({ event: 'failure', url: request.url(), failure: request.failure() }); });
    await page.goto('http://127.0.0.1:3101'); await page.waitForFunction(() => window.wm && window.menus);
    await page.screenshot({ path: path.join(output, 'desktop-dark.png') });
    await page.locator('[data-menu="File"]').click(); await page.screenshot({ path: path.join(output, 'file-menu-dark.png') }); await page.keyboard.press('Escape');
    await page.evaluate(() => wm.updateSettings({ appearance: 'light' }));
    await page.screenshot({ path: path.join(output, 'desktop-light.png') });
    await page.evaluate(async () => { const w = wm.openApp('sketch'); await w.controller.ready; });
    const canvas = page.locator('.sketch-viewport canvas'), box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width * .3, box.y + box.height * .4); await page.mouse.down();
    await page.mouse.move(box.x + box.width * .7, box.y + box.height * .6, { steps: 15 }); await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('.sketch-status').textContent.includes('Draft saved'));
    await page.screenshot({ path: path.join(output, 'sketch-light.png') });
    await page.evaluate(() => { wm.updateSettings({ appearance: 'dark' }); wm.openApp('safari'); });
    await page.waitForFunction(() => !document.querySelector('.safari-status').textContent.startsWith('Requesting'), null, { timeout: 15000 });
    const safari = { url: await page.locator('.safari-address-input').inputValue(), status: await page.locator('.safari-status').textContent(), external: await page.locator('.safari-external').getAttribute('href'), frameURL: page.frames().find(frame => frame.parentFrame())?.url() || null };
    await page.screenshot({ path: path.join(output, 'safari-live.png') });
    const report = { checkedAt: new Date().toISOString(), engine: 'firefox', errors, network, safari };
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } finally { await browser?.close(); server.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
