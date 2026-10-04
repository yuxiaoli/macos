# macOS Web Desktop

A Monterey-inspired desktop simulation built with vanilla JavaScript and locally bundled jQuery. The application is a static site; it has no server-side account, real OS shell, cloud sync or PWA.

**Live demo:** https://yuxiaoli.github.io/macos/ (published independently from local source changes)

## Desktop and menus

- All eight top menus are functional: Apple, current application, File, Edit, View, Go, Window and Help. Commands use the active window and retain its file selection or text selection while a menu is open. Unavailable commands are disabled.
- Menus support arrows, Enter, Escape, submenus, outside-click dismissal and focus restoration. Help contains a local guide, shortcuts and storage/browser limitations.
- Finder, TextEdit and Terminal have independent windows. The Dock returns to an application's most recently used window; use New Window/New Document to create another. Reopening the same text file focuses its existing editor.
- Windows can be dragged, resized, minimized and maximized. Window Overview lists all windows, including minimized ones; Show Desktop temporarily hides windows. Window bounds are constrained after viewport changes and restoration.
- Desktop icons show `/Desktop` files directly and share Finder's single-selection, open, rename, create, Get Info, Trash, sort and context-menu actions.
- Spotlight searches application names and names throughout the virtual filesystem. No file-content search is implied.
- Battery reports browser-provided level/charging state or explicitly says unavailable. Network reports browser online/offline state. Control Center exposes appearance, reduced motion and Dock hiding. The clock opens a navigable monthly calendar.
- Settings persist dark/light/system appearance, local wallpaper choices, Dock settings, reduced motion and clock format. The default is dark.

## Applications

- **Finder:** independent folder navigation/history/search in each window; new folders/text files, rename, Get Info, name/type sort and move to Trash. File names and contents are rendered as text, including HTML-like names. No file copying, moving, multi-selection, bulk import or full-library backup is provided.
- **TextEdit:** independent plain-text documents, Undo/Redo, Save, Save As, `.txt` export, character count, font/size display controls and unsaved-change indicators. Closing, restarting or deleting affected folders checks dirty documents first. Cancelling a batch check leaves every window and draft intact. Font/size affect display, not the saved plain-text format.
- **Trash:** restore files or entire folder trees and Empty Trash after confirmation. Restore resolves name conflicts and falls back to Documents when the original parent is missing. Empty Trash is permanent.
- **Terminal:** independent working directories, command histories, wrapping command input and Matrix cleanup. Supports `help`, `ls`, `pwd`, `cd`, `cat`, `mkdir`, `touch`, `open`, `echo` (including `>` and `>>`), `clear`, `whoami`, `date` and `matrix`. These commands only operate on browser-local virtual files; they never execute an OS shell. Writes refresh clean editors; dirty editors retain their draft and show a conflict.
- **Safari:** default and Home URL is `https://vectorindex.cloud`. Only HTTP(S) addresses are accepted. Back/Forward track navigations initiated in the app's address bar and Home control. Reload, loading feedback and Open Externally are available. Cross-origin iframe links are not tracked; a load event is not proof that a site rendered successfully. Site policies or network restrictions may block embedding, so use the external-page control when needed.
- **Sketch:** fixed 1024 × 768 drawing document in a scaled viewport, Pointer Events with outside-release handling, the last 20 drawing states for Undo/Redo, clear, PNG import/export, and a latest-draft save in IndexedDB after each stroke. Window resizing scales the view without cropping or changing the bitmap. Replacing existing artwork with New/Import asks first. Draft-storage failures preserve the canvas and advise exporting. PNG imports are limited to 25 MB and 16 million pixels before decoding.
- **Calculator:** ordinary stepwise arithmetic, decimals, sign, percent, consecutive operations, repeated equals, keyboard input, division-by-zero feedback and precision cleanup. Minimizing and restoring preserves the calculation. Closing and opening a fresh Calculator resets it cleanly to zero; a restored desktop session uses its saved calculation snapshot.
- Studio has been removed.

## Keyboard

- Command/Ctrl+S: Save; Shift+Command/Ctrl+S: Save As
- Command/Ctrl+N: new applicable window/document; Shift+Command/Ctrl+N: new Finder folder
- Command/Ctrl+W: close active window
- Command/Ctrl+Space: Spotlight; F3: Window Overview
- Finder: arrows/Home/End select, Enter opens, F2 renames, Delete/Backspace moves to Trash, Shift+F10 opens the context menu
- Calculator: numbers, `+`, `-`, `*`, `/`, Enter; F9 changes sign
- Matrix: Escape or Exit Matrix

Clipboard availability depends on browser permission and secure-context support. Failed clipboard operations report an error. Cut removes text only after clipboard copying succeeds. Safari's embedded page content is never an Edit-menu target.

## Storage and data protection

Files and Trash remain in `localStorage` on this browser, device and site origin, using the existing `macos.web.filesystem.v1` format. Existing v1 files require no migration. Clearing site data removes them; private browsing may not retain them. **Export important text documents and PNG drawings for backup.**

- Limits: 1 MB per text file, 4 MB serialized filesystem, 5,000 nodes.
- Failed writes or Empty Trash transactions keep the prior in-memory/saved state.
- A stale second tab cannot silently overwrite a newer persisted filesystem. Reload that tab, exporting unsaved drafts first.
- Malformed saved filesystem data is preserved; read-only sample files are shown instead of overwriting it.
- File-change events update all windows, desktop files and Spotlight. Folder renames update affected paths. Terminal writes never silently replace an unsaved editor draft.
- Settings and workspace use separate versioned keys. Restoration includes window bounds/display state, Finder folders, saved TextEdit documents and Terminal working directories. Unsaved untitled drafts are excluded. Saved documents reopen from their saved contents, not an unsaved buffer. Invalid paths fall back safely or are omitted. Restored Safari windows start at the configured Home.
- Sketch's latest draft uses its own IndexedDB database and does not consume the virtual text-filesystem quota.

## Local development

With Node.js 20 or newer:

```sh
npm ci
npm start
```

Open http://localhost:3000. The static application has no build step. Scripts, SVG icons, wallpapers and styles are served locally; fonts use the local system stack. No CDN is required for the shell or local applications. Safari pages still require their own network access.

The original Bun server is also available:

```sh
cd site
bun install
bun run server.ts
```

## Verification

```sh
npm run check
npm test
npx playwright install chromium firefox webkit
npm run test:browser
```

On Linux, Playwright browser system dependencies may also be required (`npx playwright install --with-deps` on a suitably authorized development machine). `CHROMIUM_EXECUTABLE_PATH` can select an existing Chromium installation; `/usr/bin/chromium` is detected as a fallback when the bundled browser is absent. `PLAYWRIGHT_BROWSERS_PATH` can select a writable browser cache.

`check` parses application scripts and verifies referenced local assets. Node/jsdom regressions cover the file model, Terminal, isolated controllers, commands/menus, app models and window/session integration, including quota, damaged data and stale-tab protection. jsdom cannot prove pointer capture, browser canvas/PNG decoding, native modal focus, real layout or iframe embedding.

The Playwright suite in `tests/e2e/desktop.spec.cjs` contains 24 journeys for each of Chromium, Firefox and WebKit. It covers menu keyboard/focus/disabled commands, failed-Cut safety, status panels, independent windows, file conflicts and Trash, drag/resize, native dialogs, overview, restoration, Calculator, real Sketch canvas/PNG/draft flows, Safari navigation validation and third-party-network-blocked shell startup. Safari navigation tests use explicit local test fixtures; they do not certify that the live external homepage permits embedding. Test output and HTML reports are ignored by Git.

For a live homepage/network probe and dark/light/menu/Sketch screenshots, run `node tests/browser-probe.cjs` with Firefox installed. Outputs are written to the ignored `test-results/visual-probe` directory; run it after the browser suite, which clears test results. TLS errors are reported without disabling certificate checks.

Run one engine with `npm run test:browser -- --project=firefox` or `npm run test:browser:chromium`. `npx playwright test --list` validates discovery only and is not a browser test pass. Do not treat an engine blocked by missing libraries or process permissions as passed. Complete the real-browser matrix and live Safari embedding check before release.

See [the dated verification record](context/VERIFICATION.md) for the last actual run and environment limitations.

## Deployment

Source work uses `develop`; the `site` directory is published on `gh-pages`. The existing Windows helper `scripts/deploy.bat` pushes `develop` and runs `git subtree push --prefix site origin gh-pages`. Deployment is a separate action: test first and preserve both branches' existing history. `main` is not part of this workflow.

## Structure

```text
site/
  index.html           Static shell
  js/desktop.js        Window manager, Dock, settings and session lifecycle
  js/menus.js          Shared commands, menu bar, Spotlight and status panels
  js/workspace.js      Finder, TextEdit, Trash and Terminal controllers
  js/file-store.js     Transaction-safe persistent virtual filesystem
  js/terminal.js       Safe virtual command interpreter
  js/apps.js           Safari, Sketch and Calculator
  css/                 Local desktop, menu, workspace and app styles
  assets/              Local SVG icons and wallpapers; license notices
  vendor/              Bundled jQuery and its license
scripts/                Static server, validation and existing deployment helper
tests/                  Node/jsdom regression tests and e2e browser journeys
src/macos/              Original source and MIT license
```

## License

Based on Chetas's original CodePen concept. See `src/macos/LICENSE.txt`, `site/assets/LICENSE.txt` and the bundled vendor license notices.
