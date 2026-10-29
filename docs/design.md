# RigApp: design notes

The why behind decisions, and the results of any tests that informed them. The bible says what was decided; this says why. Newest first.

## Lean on tokens; T3 Code first, Operant only for named parts (2026-10-29)
- **Decision:** RigApp adds nothing to a seat's context by default. Hindsight, CodeGraph and the browser are opt-in per pod, and the settings show roughly how many tokens each tool's definitions cost a seat. RigApp writes no extra prompts into seats. UX and protocol follow T3 Code. From Operant only these parts are borrowed: the browser (in-app panel, CDP proxy, `@playwright/mcp` host, action gate), the auto-updater, the xterm setup and the no-console-window spawn helper.
- **Why:** doole found Operant grew bloated and used more tokens than plain Claude Code. Every MCP server adds its tool list to every turn of every seat it is given to, and a rig multiplies that by its seat count.
- **Evidence:** doole's report; Operant 3.6.1 source in `.ref/operant`.

## Reuse instead of rebuild (2026-10-29)
- **Decision:** borrow Operant's browser, updater and terminal setup (MIT, same author) instead of writing new ones; send OpenRig pull requests for the missing routes as a side job.
- **Why:** Operant's browser already solves AI control, approvals, take-over and safe CDP proxying with tests. Upstream routes would let RigApp drop its stopgaps.

## Read harness session files for chat (2026-10-29, proposed)
- **Decision:** the chat view is built from each seat's harness session file (read-only), not from pane text.
- **Why:** OpenRig only serves ANSI pane text, which cannot give tool cards, diffs or clean messages. The daemon itself reads the same files internally (`session-jsonl.ts`). Reading is not talking to the harness; all writes still go through OpenRig.
- **Evidence:** `.ref/notes-openrig.md` section 0 item 4 and Gaps.

## Server between the UI and the daemon (2026-10-29)
- **Decision:** the web UI talks only to RigApp's Node server, which alone calls OpenRig.
- **Why:** the daemon refuses any request with an `Origin` header (403, checked live), so a browser page cannot call it. A server also lets a phone connect later.

## Windows and Linux (2026-10-29)
- **Decision:** RigApp runs natively on Windows and Linux. On Windows it uses a daemon in WSL (or a native one if OpenRig ever supports it); on Linux the local daemon. RigApp never patches OpenRig.
- **Why:** OpenRig needs tmux and does not support native Windows (its docs say WSL2 is the Windows route).

## Look (2026-10-29, proposed)
- **Decision:** dark first, light theme too; one ground, one ink, one teal accent (`#35b39b` dark, `#127a68` light); amber for waiting, red for errors; system UI font, monospace only in code and terminals; surfaces split by tone steps.
- **Why:** doole's global UI rules; the `design::general` Hindsight bank has only website styles, none for app screens.
- **Evidence:** `mockups/rigapp-direction.html` and `mockups/shots/`.
