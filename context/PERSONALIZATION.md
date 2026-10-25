# Personal desktop update — 2026-10-25

Starting source: develop ef144dd080c38dde47bfa02b2eb6c09939045efd.
The repository is Sean's own reconstructed desktop; no upstream remote or synchronization is involved. Remote default was verified as develop. main/master are outside this change.

Active scope and acceptance are recorded in the existing context/PLAN.md.

## Application review

- Finder/Desktop: Welcome.txt and Project/About Sean.txt introduce the person, work and selected public projects in first-run examples.
- TextEdit: Documents/notes.txt starts with an original short note about building useful things. The Dock opens the existing notes.txt on an ordinary first TextEdit launch; New Document remains blank. Edited notes are opened as saved, and deleted notes are not recreated. Saved files use the unchanged v1 filesystem and are never reseeded. The later user-authorized exact-default Welcome upgrade is documented below.
- Terminal: sean@vectorindex prompt, sean whoami and a brief welcome; commands and virtual file behavior retained.
- Safari: requested Vector Index Home retained, with useful external shortcuts; URL startup config may override Home for that visit.
- Sketch, Calculator, Settings and Trash: reviewed; practical controls, existing artwork/drafts and data behavior retained. About dialogs identify this personal desktop and retain concept/license credit, without adding advertising to calculations or artwork.
- Help/About: concise professional introduction and public homepage/GitHub/source references; Chetas's original concept remains credited.

The publication and live checks below complete the implemented scope, with explicit browser-host limitations.

## Verification before publication

- Static JavaScript/assets/license check passed. All 176 Node tests passed.
- Chromium: all 26 browser journeys passed, including both new startup-config journeys.
- WebKit on this Windows host: 23/26 passed, including both new startup-config journeys. Existing calendar/status and two Sketch-draft journeys failed; comparison to the pre-change baseline is in progress. These failures are not reported as passes.
- JSON Schema compiled with AJV 2020-12; the example validates. Independent implementation/schema review found no blocker.
- Explicit modal Tab wrapping fixed a reproduced Chromium focus escape; viewport test now waits for the same required bounds after the resize event.
- Firefox engine installation and final live publication checks are pending at this source checkpoint.

## Publication and live verification — 2026-10-25

- Feature source develop 5aa1ded991e8bd25e9ed2bd53a5527eafee85058; existing Pages publication 81ec508df45c934b0b84e788a25f086113f7b758, a fast-forward descendant of the prior gh-pages head. Both have site tree 1b0a3b2b0ebb6416129187a9a4afe1ed7bb67bce.
- Pages build succeeded: https://github.com/yuxiaoli/macos/actions/runs/40203254225 . Public URL remains https://yuxiaoli.github.io/macos/ . Nine fetched HTML/runtime/style files returned HTTP 200 and SHA-256 hashes equal canonical source Git blobs (Windows working-copy CRLF conversion is excluded from this comparison).
- A fresh production browser verified page identity, first-run notes, ordinary TextEdit opening the notes, normal eight-app Dock, Terminal prompt/whoami, and About text with original Chetas credit.
- Production startup URL enabled exactly Safari/TextEdit/Calculator, restored the saved notes, set nested Safari Home to https://vectorindex.cloud/work, and showed the temporary-config notice. Invalid version/unsafe URL config restored all default apps and the regular workspace with a visible warning. Saved documents were not replaced.
- Public Vector Index portfolio loaded normally through Safari's Open Externally action in Chrome. Embedded page rendering could not be verified in the macOS frame in this environment; its fallback remains available and no sandbox/certificate/security settings were weakened.

## Browser verification limitations

- Chromium: 26/26 passed. Node: 176/176 passed. Static check and AJV schema/example validation passed. New startup journeys also passed WebKit.
- WebKit full run: 23/26 passed. The earlier calendar/status timeout did not recur in three isolated repeats (3/3 passed). Both Sketch draft-save failures reproduce on the pre-change ef144dd baseline: the same PNG Blob put throws UnknownError, Error preparing Blob/File data to be stored in object store. Plain string/object writes work. DraftStore/calendar source sections are unchanged. Existing export warning protects the drawing. This is not claimed as a complete WebKit pass.
- Official Firefox 155 / Playwright v1543 downloaded, but launch is BLOCKED by this Windows host's incorrect side-by-side configuration. The full run never reached application journeys (spawn UNKNOWN); a direct --version diagnostic confirmed the side-by-side failure. No system runtimes or security settings were changed. Firefox is not reported as passed.
- Local external evidence: macos-live-assets.json, macos-baseline-verification.md, macos-idb-probe.json, macos-matrix.txt and macos-firefox.txt in the task workspace.

## Richer Welcome follow-up — 2026-10-25

The user supplied an iPhone screenshot showing the untouched old Welcome.txt still saved in their browser and explicitly requested a richer personal introduction. The scope was first recorded and pushed in canonical PLAN commit 717a1e82a92297d5fdff4fddb14b1224f176cfc9.

Welcome.txt uses the approved canonical welcome; other desktop personalization is retained.

Only Desktop/Welcome.txt with full text exactly equal to one of the two known untouched bundled defaults is upgraded. Edited text (including tiny edits), notes.txt, renamed/deleted files, folders and Trash are preserved. The v1 schema stays unchanged. Migration uses the normal guarded write transaction; quota/denied/stale/read failures preserve stored data and prior valid contents.

Source and all 181 Node tests passed, including five migration safety cases; all 26 Chromium regression journeys passed. A mobile Chromium probe passed fresh, both untouched legacy defaults, edited Welcome/notes preservation, deleted-file preservation and zero page errors in isolated contexts. Published feature source bf301a05e395b72c615806920b3cc4a0b05121cc as Pages commit 857655811e28eaa02016f1f3dbafe6dd29cc559e (site tree 55573917b9e1b5b3c783bb37afcf6a32934d6687). Pages build succeeded: https://github.com/yuxiaoli/macos/actions/runs/40206081997 . The actual existing Chrome profile was verified before/after: its untouched 137-character generic Welcome became the rich 725-character welcome, restored in the same saved document. No document editing or storage reset was used. Isolated edited/missing cases remain preserved. Final asset hashes and the readable welcome copy are in the task delivery artifacts.
