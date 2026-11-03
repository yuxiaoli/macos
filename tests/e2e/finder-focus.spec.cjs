'use strict';
const { test, expect } = require('@playwright/test');

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
  test(`Finder keeps keyboard focus visible without a pointer line at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.waitForFunction(() => window.wm && window.workspace);
    const finder = page.locator('.window[data-app="finder"]');
    await expect(finder.locator('.finder-grid')).toBeFocused();
    await expect(finder.locator('.finder-grid')).toHaveCSS('outline-style', 'none');
    await page.locator('#dock-finder').click();
    const grid = finder.locator('.finder-grid');
    const search = finder.locator('.finder-search');
    await expect(grid).toBeFocused();
    await expect(grid).toHaveCSS('box-shadow', 'none');
    await expect(grid).toHaveCSS('outline-style', 'none');
    const names = await grid.locator('.file-item').allTextContents();

    await search.click();
    await page.keyboard.press('Tab');
    await expect(grid).toBeFocused();
    await expect(grid).toHaveCSS('box-shadow', 'none');
    await expect(grid).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('ArrowDown');
    await expect(grid.locator('.file-item').first()).toBeFocused();
    await expect(grid.locator('.file-item').first()).toHaveCSS('outline-style', 'solid');

    await search.fill('no-such-finder-entry-20261103');
    await expect(grid.locator('.empty-folder')).toContainText('No matching files');
    await page.keyboard.press('Tab');
    await expect(grid).toBeFocused();
    await expect(grid).toHaveCSS('outline-style', 'solid');
    await expect(grid).toHaveCSS('box-shadow', 'none');
    await search.fill('');
    expect(await grid.locator('.file-item').allTextContents()).toEqual(names);

    // A genuinely empty folder must retain a visible keyboard focus target too.
    await page.evaluate(() => window.fileStore.create(['Desktop'], 'Focus Empty', 'folder', ''));
    await finder.locator('.file-item[aria-label="Focus Empty"]').dblclick();
    await expect(finder.locator('.empty-folder')).toContainText('This folder is empty');
    await finder.locator('.finder-search').click();
    await page.keyboard.press('Tab');
    await expect(finder.locator('.finder-grid')).toBeFocused();
    await expect(finder.locator('.finder-grid')).toHaveCSS('outline-style', 'solid');
    await expect(finder.locator('.finder-grid')).toHaveCSS('box-shadow', 'none');

    await finder.locator('[title="Open Documents"]').click();
    await expect(finder.locator('.finder-location')).toHaveText('/Documents');
    await expect(finder.locator('.finder-grid')).toHaveCSS('box-shadow', 'none');
    await finder.locator('[data-command="back"]').click();
    await expect(finder.locator('.finder-location')).toHaveText('/Desktop/Focus Empty');
    await finder.locator('[data-command="forward"]').click();
    await expect(finder.locator('.finder-location')).toHaveText('/Documents');
    await page.locator('[data-menu="View"]').click();
    await page.locator('.desktop-menu [data-command="appearance"]').focus();
    await page.keyboard.press('ArrowRight');
    await page.locator('.submenu [data-command="appearance-light"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
    await finder.locator('.finder-search').click();
    await page.keyboard.press('Tab');
    await expect(finder.locator('.finder-grid')).toHaveCSS('outline-style', 'solid');
    await expect(finder.locator('.finder-grid')).toHaveCSS('box-shadow', 'none');
    await finder.locator('[aria-label="Close Finder"]').click();
    await page.locator('#dock-finder').click();
    await expect(page.locator('.window[data-app="finder"] .finder-grid')).toHaveCSS('box-shadow', 'none');
    await page.locator('.window[data-app="finder"] [aria-label="Close Finder"]').click();
    await page.locator('#dock-finder').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.window[data-app="finder"] .finder-grid')).toBeFocused();
    await expect(page.locator('.window[data-app="finder"] .finder-grid')).toHaveCSS('outline-style', 'solid');
  });
}

test.describe('touch Finder', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('touch activation does not add a list focus border or line', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.wm && window.workspace);
    await page.locator('#dock-finder').tap();
    const grid = page.locator('.window[data-app="finder"] .finder-grid');
    await expect(grid).toBeFocused();
    await expect(grid).toHaveCSS('box-shadow', 'none');
    await expect(grid).toHaveCSS('outline-style', 'none');
    await grid.locator('.file-item').first().tap();
    await expect(grid.locator('.file-item').first()).toHaveAttribute('aria-selected', 'true');
  });
});
