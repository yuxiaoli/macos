# Verification record — 2026-10-04

Validation was run against the local static site on the cloud development computer. This record does not certify a deployed revision or a complete three-engine matrix.

## Completed

- `npm run check`: passed. Application JavaScript parses; local HTML/CSS/icon references and required licenses exist.
- `npm test`: **170 passed, 0 failed, 0 skipped** in the final recorded Node/jsdom run.
- Playwright Firefox 155.0: **24 browser journeys passed in a single final run** against the visually refined candidate. The complete run includes the original desktop journeys plus Terminal wrapping/history/multiline input, Calculator long-result resizing and visible key bounds, and keyboard-operated Settings switches.
- `npx playwright test --list`: discovers the same suite for Chromium, Firefox and WebKit (24 journeys per engine, 72 total). Discovery is not an execution pass.
- Real Firefox screenshots visually inspected at 1440 × 1000: dark/light desktop and all application windows, File and Appearance menus, Spotlight, Settings switches, Trash states and file dialogs. Additional comparisons use the original `f05b81f` baseline and the preceding `ace8abf` publication, with narrow windows and explicitly labelled 150%-equivalent rendering. Text, controls, local icons, window framing and fixed-canvas scaling render coherently, with no blank application, clipping or error overlay observed in those screenshots.
- Optional live/visual probe reports **zero JavaScript page errors**.

The Firefox flows exercise all eight menu openings, keyboard navigation/submenus/focus restoration, disabled actions, selection-preserving failed Cut, status panels and calendar, independent Finder/TextEdit/Terminal windows, Spotlight, correct-window saves, multi-document delete cancellation, file rename propagation, conflict handling, Trash restore/confirmation/emptying, quota failures, corrupted storage, stale tabs, real drag/resize, modal interruption, overview, small-screen bounds, session/settings restoration, Calculator, Sketch pointer-release/Undo/Redo/PNG/IndexedDB restoration, and Safari navigation validation. An external-network-blocked startup test confirms the shell and local apps request no third-party resources.

## Bugs caught during browser verification

- Calendar CSS arrow content changed accessible button names. Explicit accessible labels now keep navigation labels stable.
- Native modal opening during a drag left pointer capture active and allowed a background window to keep moving. The window manager now cancels interrupted gestures and releases capture; the real-pointer regression passes.
- A separate integration review fixed Edit actions targeting an old text field after switching active windows, and unwanted extra Finder windows for folder/Reveal navigation. The focused browser regression passes.

## Visual refinement acceptance

The original window proportions were compared with the preceding implementation using real Firefox screenshots, rather than code inspection alone. Refinements restore compact 30px titlebars, quieter neutral chrome, lightweight toolbar groups, coherent icons and a readable single-panel calculator. Finder and TextEdit tools fit one row at their default widths and wrap at narrow widths. Existing saved window layouts are preserved; the more compact defaults apply to newly opened windows.

Terminal no longer inherits a full-width form focus rectangle. Its command textarea uses regular-weight local monospace, native caret/selection, aligned prompt text and wrapping, while other controls retain visible keyboard focus. TextEdit similarly avoids an editor-wide blue outline. Settings controls retain semantic switch roles and native Space-key toggling. Opaque menu fallbacks prevent background text from interfering, and submenus open beside their parent with viewport bounds and keyboard return.

A 15-digit Calculator result previously wrapped and pushed the bottom key row out of view at a compact size. It now fits one line with measured font scaling, retains all five key rows, and passes repeated grow/shrink checks. Arithmetic behavior is unchanged.

The final visual set includes dark/light modes, a long Terminal working directory, multiline pasted commands, 320px Finder/TextEdit/Sketch windows, long and scientific Calculator results, and focused on/off Settings switches. Screenshot artifacts remain outside source control; a SHA-256 manifest records the runtime files used by the captured candidate.

## Unavailable validation stages

### Chromium

The installed `/usr/bin/chromium` could not launch in this environment, including the approved unrestricted test invocation. Its stderr reported:

```text
FATAL:chrome/browser/process_singleton_posix.cc:297
Check failed: . socket() failed: Operation not permitted (1)
```

The official Playwright Chromium installation was also attempted. Every built-in download attempt for Chrome for Testing 153.0.8010.12 returned an invalid/truncated ZIP (`End of central directory record signature not found`). Chromium journeys were **not run or claimed passed**.

### WebKit

The official WebKit 26.6 binary downloaded successfully, but launch validation reported missing host libraries:

```text
libgtk-4.so.1
libgraphene-1.0.so.0
libharfbuzz-icu.so.0
libmanette-0.2.so.0
libhyphen.so.0
libGLESv2.so.2
```

No OS packages, security settings or certificate configuration were changed. WebKit journeys were **not run or claimed passed**. Install the official browser dependencies on an authorized development/CI machine and rerun both remaining engines.

## Live Safari homepage

The actual `https://vectorindex.cloud/` embed was checked in Firefox without a test fixture. The request failed with `SEC_ERROR_UNKNOWN_ISSUER`; no HTTP response, Content-Security-Policy or X-Frame-Options headers were available to assess embedding. The iframe remained `about:blank`.

Certificate checks were not bypassed. The app correctly retained the configured address and external link and displayed its unverified-embedding fallback notice. This is an environment-specific certificate/connectivity result, **not proof that the website permits or blocks embedding**. Repeat the live check in a normal browser with a valid trust chain. Fixture-based Safari tests prove app navigation behavior only.

## Reproduce

```sh
npm ci
npm run check
npm test
npx playwright install chromium firefox webkit
npm run test:browser
node tests/browser-probe.cjs
```

Use `PLAYWRIGHT_BROWSERS_PATH` for a writable browser cache and `CHROMIUM_EXECUTABLE_PATH` when choosing an existing Chromium explicitly. The visual/live probe writes screenshots and its JSON report to `test-results/visual-probe/`; these artifacts are ignored by Git. Run the probe after the browser tests, which clear the test output directory.
