# Personal desktop update — 2026-10-25

Starting source: develop ef144dd080c38dde47bfa02b2eb6c09939045efd.
The repository is Sean's own reconstructed desktop; no upstream remote or synchronization is involved. Remote default was verified as develop. main/master are outside this change.

Active scope and acceptance are recorded in the existing context/PLAN.md.

## Application review

- Finder/Desktop: Welcome.txt and Project/About Sean.txt introduce the person, work and selected public projects in first-run examples.
- TextEdit: Documents/notes.txt starts with an original short note about building useful things. The Dock opens the existing notes.txt on an ordinary first TextEdit launch; New Document remains blank. Edited notes are opened as saved, and deleted notes are not recreated. Saved files use the unchanged v1 filesystem and are never seeded again.
- Terminal: sean@vectorindex prompt, sean whoami and a brief welcome; commands and virtual file behavior retained.
- Safari: requested Vector Index Home retained, with useful external shortcuts; URL startup config may override Home for that visit.
- Sketch, Calculator, Settings and Trash: reviewed; practical controls, existing artwork/drafts and data behavior retained. About dialogs identify this personal desktop and retain concept/license credit, without adding advertising to calculations or artwork.
- Help/About: concise professional introduction and public homepage/GitHub/source references; Chetas's original concept remains credited.

Validation and final source/deployment revisions will be recorded after integration.

## Verification before publication

- Static JavaScript/assets/license check passed. All 176 Node tests passed.
- Chromium: all 26 browser journeys passed, including both new startup-config journeys.
- WebKit on this Windows host: 23/26 passed, including both new startup-config journeys. Existing calendar/status and two Sketch-draft journeys failed; comparison to the pre-change baseline is in progress. These failures are not reported as passes.
- JSON Schema compiled with AJV 2020-12; the example validates. Independent implementation/schema review found no blocker.
- Explicit modal Tab wrapping fixed a reproduced Chromium focus escape; viewport test now waits for the same required bounds after the resize event.
- Firefox engine installation and final live publication checks are pending at this source checkpoint.
