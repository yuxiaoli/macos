# macOS Web Experience

A macOS Monterey-style desktop simulation built with HTML, CSS, JavaScript, jQuery and jQuery UI.

**Live demo:** https://yuxiaoli.github.io/macos/

## Features

- **Desktop:** boot animation, draggable/resizable windows, minimize/maximize, Dock, clock and wallpaper choices.
- **Finder:** create folders and text files, rename, search the current folder, back/forward/up navigation, and move items to Trash. File names and contents are rendered as text, including names containing HTML-like characters.
- **TextEdit:** edit plain text, Save, Save As, export a `.txt` copy, character count and unsaved-change indicator. Closing a dirty document or opening another asks to Save, Discard or Cancel. Font and size selectors change the editor display only, not the saved text format.
- **Trash:** restore files or whole folders with their contents. Name conflicts are resolved with a restored-name suffix; missing original folders fall back to Documents. No permanent deletion control is provided.
- **Terminal:** shares the same files with Finder and TextEdit. Supports `help`, `ls`, `pwd`, `cd`, `cat`, `mkdir`, `touch`, `open`, `echo` (including `>` and `>>`), `clear`, `whoami`, `date` and `matrix`. Quoted names, Unicode, command history and an exit button/Escape for Matrix are supported. Commands operate only on the browser's virtual files; no OS shell executes.
- **Keyboard:** native Dock/window/file action buttons, a functional File menu, Command/Ctrl+S to save, Shift+Command/Ctrl+S for Save As, Command/Ctrl+N for a new TextEdit document, and Shift+Command/Ctrl+N for a Finder folder. In Finder, use arrows or Tab to focus files, Enter to open, F2 to rename and Delete to move to Trash.
- **Other apps:** iframe-based Safari with the existing `vectorindex.io` homepage, Sketch canvas drawing, standard Calculator, Studio filter simulation and Settings wallpaper choices.

## Where files are saved

Files and Trash persist in `localStorage` on this browser, device and site origin. They are not synced to a server or your real computer's filesystem. Clearing site data removes them; private browsing may not retain them. **Export important documents as a backup.**

Each text file is limited to 1 MB, the serialized filesystem to 4 MB, and the total to 5,000 nodes. Quota failures do not claim a successful save or replace the previous in-memory file. A second tab cannot silently overwrite a newer saved state: reload it first, exporting any unsaved draft as needed. Malformed saved data is preserved and opens read-only sample files instead of resetting user data.

Safari navigation is limited by other websites' iframe policies. Studio remains a filter simulation, and some legacy menu-bar controls are decorative. Wallpaper choices currently reset on reload. This is a browser desktop simulation, not an implementation of macOS.

## Local development

With Node.js 20 or newer:

```sh
npm ci
npm start
```

Open http://localhost:3000. The static application itself has no build step. jQuery, jQuery UI, fonts and icons load from their existing CDNs, so an internet connection is needed for the current desktop shell.

The original Bun server remains available:

```sh
cd site
bun install
bun run server.ts
```

## Tests

```sh
npm run check
npm test
```

`check` parses all application JavaScript and verifies local asset references. Node tests cover the file model, Terminal parser, persistence/reload, storage errors, stale-tab protection, validation, Trash restore and DOM-level application workflows. The DOM tests use jsdom and stub window dragging/resizing; they do not replace real-browser visual or pointer-interaction checks.

## Deployment

The repository uses `develop` for the source and publishes the `site` directory on `gh-pages`. The existing Windows helper `scripts/deploy.bat` pushes `develop` and runs `git subtree push --prefix site origin gh-pages`. Run tests first and preserve both branches' existing history. `main` is not used by this workflow.

## Project structure

```text
site/
  index.html           Desktop shell and legacy apps
  js/file-store.js     Persistent virtual filesystem
  js/workspace.js      Finder, TextEdit, Trash and Terminal UI
  js/terminal.js       Safe virtual command interpreter
  css/workspace.css    File workflow styles
  server.ts            Original Bun static server
scripts/
  serve.cjs            Dependency-free Node static server
  check.cjs            Syntax and local-asset checks
  deploy.bat           Existing Windows Pages deployment helper
tests/                  Node and jsdom regression tests
src/macos/              Original source and MIT license
```

## License

Based on Chetas's original CodePen concept. See `src/macos/LICENSE.txt` for the MIT license.
