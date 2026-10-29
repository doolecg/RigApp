# RigApp: systems

What each system is, where it lives and how it connects to the others. Update when a system is added or changes. M1 in progress (2026-10-29): the server and web UI exist; desktop and seat tools are still planned.

## OpenRig daemon (external, the only driver)
- **What it does:** runs rigs (projects) of seats (threads) in tmux. RigApp drives it and never talks to a harness directly.
- **Where:** WSL2 Ubuntu on Windows (OpenRig does not support native Windows), or the local machine on Linux. Live here: OpenRig 0.7.4 at `http://127.0.0.1:7433`, reachable from Windows through WSL localhost forwarding. State file `~/.openrig/daemon.json` holds `{pid, port, host, db, startedAt}`.
- **Talks to:** RigApp's server only, over HTTP, SSE and (when enabled) one WebSocket.
- **Source read:** github.com/mvschwarz/openrig cloned to `.ref/openrig` (0.7.1; live daemon is 0.7.4, so every route is re-checked with a GET before code relies on it). Full route map with file:line: `.ref/notes-openrig.md`.

### Rules the daemon imposes
- Any request with an `Origin` header gets 403 `browser_origin_refused` (checked live). So only RigApp's Node server calls the daemon; the web UI never does.
- No auth on loopback. Tokens only exist for non-loopback binds and are env-only.
- Seat address is the session name `{pod}-{member}@{rig}` (e.g. `queue-worker@kernel`); logical id is `{pod}.{member}`.
- Sends carry `X-OpenRig-Session` to name the sender. RigApp uses the rig's terminal seat (e.g. `operator-human@kernel`) as the human, else none.
- Paths in responses are daemon-side (WSL) paths.

### API surface RigApp uses
| Need | Route |
| --- | --- |
| Health and version | `GET /healthz`, `GET /api/health-summary/version` |
| Projects (rigs) | `GET /api/ps`, `GET /api/rigs/summary` |
| Threads (seats) by pod, harness, status | `GET /api/rigs/:rigId/nodes`, detail `GET /api/rigs/:rigId/nodes/:logicalId` (adds `resumeType`, `resumeToken`, `transcript`, `contextUsage`) |
| Lead seat | `GET /api/rigs/:rigId` field `representative` (null unless one `delegates_to` root) |
| Topology graph | `GET /api/rigs/:rigId/graph`, edges in `GET /api/rigs/:rigId` |
| Send a message | `POST /api/transport/send {session, text}`; refusals are 409 with `reason` |
| Pane text | `GET /api/rigs/:rigId/nodes/:logicalId/preview?lines=`, `POST /api/transport/capture` |
| Search across seats | `GET /api/transcripts/:session/grep?pattern=` (pane log) |
| Rig up / down | `POST /api/rigs/:id/up`, `POST /api/up`, `POST /api/down {rigId, snapshot?, delete?}` |
| Snapshots | `GET/POST /api/rigs/:rigId/snapshots`, `POST /api/rigs/:rigId/restore/:snapshotId` (202 + `attemptId`), `GET .../restore/status/:attemptId` |
| Adopt tmux sessions | `GET /api/adapters/tmux/sessions`, `POST /api/discovery/scan`, `POST /api/discovery/:id/bind`, `/adopt` |
| Specs | export `GET /api/rigs/:rigId/spec`; validate `POST /api/rigs/import/validate` (RigSpec YAML), `POST /api/agents/validate` (AgentSpec YAML); review `POST /api/specs/review/rig` |
| Files (CULTURE.md etc.) | `GET /api/files/read`, `POST /api/files/write` (allowlisted roots only; live root: `workspace`) |
| Bundles | `POST /api/bundles/create`, `/inspect`, `/install` (daemon-side paths only) |
| Usage | `GET /api/provider/usage`, `GET /api/telemetry/usage/series`, seat `contextUsage` |
| Config | `GET /api/config`, `POST /api/config/:key` |

### How output is streamed
- `GET /api/events?replay=N` (SSE): every rig event (`agent.activity` with state `running|needs_input|idle|unknown`, `session.*`, `node.*`, `snapshot.created`, `restore.*`, `chat.message`). Always pass `replay`; leaving it out replays the whole log.
- `GET /api/activity/events` (SSE): change notices only; re-read `/api/ps` or nodes after each one (what the OpenRig TUI does).
- `GET /api/rigs/:rigId/chat/watch` (SSE): the rig chatroom.
- `ws://127.0.0.1:7433/api/terminal/:session`: raw ANSI out, JSON `{type:"keys"|"text"|"scroll"}` in. Fixed 90x27, no resize. Only registered when daemon config `ui.enabled` is true (it is false here now).

### OpenRig gaps
Things RigApp needs that have no route. Each has a stopgap; each is a candidate pull request to OpenRig (bible idea map, side job).
1. **Structured chat (messages, tool calls, diffs).** The daemon only serves pane text. Stopgap: RigApp's server reads the harness session file itself, read-only, located from `resumeType`/`resumeToken` (Claude `~/.claude/projects/<cwd>/<id>.jsonl`; Codex rollout; Pi `.jsonl` path). From Windows through `\\wsl$\<distro>\...`.
2. **Approvals.** No pending-prompt list and no approve/deny route. Detect from `agent.activity` `needs_input`, read the prompt from the pane or session file, answer by sending keys.
3. **Interrupt.** No route. Stopgap: terminal WS `keys:["Escape"]` when `ui.enabled`, else the CLI `wsl.exe -d <distro> -- tmux send-keys -t <session> Escape`.
4. **Terminal WS off by default.** Needs `rig config set ui.enabled true` and a daemon restart; RigApp's setup screen shows the steps and never changes it itself. Without it, the terminal is a 3 s preview poll with no typing.
5. **Saving an edited spec.** No update route. Stopgap: export, edit, validate, then re-import (or `expand`/`members`/`edges` calls for small changes).
6. **CULTURE.md outside allowlisted roots.** Needs `OPENRIG_FILES_ALLOWLIST` on the daemon, or RigApp reads it through `\\wsl$` read-only.
7. **Bundle upload/download.** Paths only. RigApp places files where WSL can see them and passes the Linux path.
8. **No lead-seat field.** Fallback: first `delegates_to` root, else the first agent seat.
9. **Terminal resize.** Fixed 90x27 by design.

## RigApp server (`apps/server`)
- **What it does:** the only process that talks to OpenRig. Finds the daemon (WSL on Windows, local on Linux, or a set address), merges its SSE streams and session files into one snapshot-then-events stream per project and per thread, and serves the built web UI.
- **Where:** `apps/server` (Node, runs on Windows or Linux natively).
- **Talks to:** OpenRig daemon (HTTP/SSE/WS, no Origin header); the web UI over one WebSocket (`/ws`, typed envelope, T3-style snapshot + sequenced events); WSL files through `\\wsl$`; `wsl.exe` only for the stopgaps above.
- **Built so far:** `src/setup.ts` finds the daemon (`RIGAPP_DAEMON_URL`, else the port in `~/.openrig/daemon.json` read through `wsl.exe`, else 7433) and, when it does not answer, checks WSL2 (`wsl.exe -l -v`, distro from `RIGAPP_WSL_DISTRO` or the default), tmux and `rig --version` (through `bash -ic` so nvm's PATH loads). `src/hub.ts` follows `/api/events?replay=0` and `/api/activity/events`, re-reads `/api/ps`, `/api/rigs/:id` and `/api/rigs/:id/nodes` at most every 300 ms, and pushes the whole shell to the UI when it changes; while the daemon is down it asks `/healthz` every 5 s. `src/bin.ts` serves `apps/web/dist` and `/ws` on `127.0.0.1:7480` (`RIGAPP_PORT`), and refuses WebSocket origins other than its own and the dev UI's.
- **Chat (gap 1 stopgap):** `src/chat/` reads a Claude Code seat's session file, read-only, from the path the daemon reports in `contextUsage.transcriptPath` (through `\\wsl.localhost\<distro>` on Windows). `Thread` polls the file size every second (fs.watch is unreliable across `\\wsl.localhost`) and parses only new lines; `ClaudeParser` keeps user and assistant text and tool calls (results cut at 4000 characters), and skips thinking, sidechain and bookkeeping lines. `Chats` opens one thread per seat while a UI watches it and follows a new file when the seat restarts. Codex and Pi seats say chat is not built yet; terminal seats have none.
- **Actions:** `src/actions.ts` sends text with `POST /api/transport/send`, signed by the rig's terminal seat (`X-OpenRig-Session`), and turns 409 refusal reasons into plain words (`mid_work` offers "Send anyway", which resends with `force`). Approve, Deny and Stop press Enter or Escape with `wsl.exe -d <distro> -e tmux send-keys -t <session>` (gaps 2 and 3). For a seat in `needs_input`, `loadProjects` adds the last 30 pane lines from `POST /api/transport/capture` as `prompt`.
- **Files:** `src/files.ts` lists and reads the seat's `cwd` through `\\wsl.localhost`, read-only, refusing paths that leave it; files are cut at 200 KB and binary files are not shown.
- **Wire types:** `packages/contracts` (types only): `Shell` (daemon info, setup checks, projects with pods and seats), `ChatItem`, `ServerMessage` (`shell`, `thread` with `reset` or upserted items), `ClientMessage` (`setup.recheck`, `thread.subscribe`, `thread.unsubscribe`, `seat.send`, `seat.key`, `files.list`, `files.read`).
- **Saved:** settings and keybinds in the user data folder (not built yet). No copy of OpenRig state.

## Web UI (`apps/web`)
- **What it does:** sidebar of projects and threads, chat, Overview, command palette, right panel, graph, terminal, specs, browser, settings. Built only from shadcn components and lucide icons.
- **Where:** `apps/web` (React, Vite, Tailwind v4, shadcn).
- **Talks to:** RigApp server only. Dev: Vite on `localhost:7481` proxies `/ws` to 7480 (`pnpm dev`).
- **Built so far:** sidebar, chat, composer (`@` seat, `/` actions), approval card, Overview, Ctrl+K palette (cmdk), Seat and Files tabs. `lib/seen.ts` keeps when you last opened each seat; a seat whose daemon `lastActivityAt` is newer is "finished" and gets an unread dot. Playwright tests in `e2e/` run two servers on 7490 (live daemon) and 7491 (no daemon).
- **Saved:** UI state (panel sizes, last open thread, last seen per seat) in local storage.

## Desktop shell (planned, `apps/desktop`)
- **What it does:** Electron window; starts the server as a child process, loads it, auto-updates from GitHub releases, hosts the in-app browser (M5).
- **Where:** `apps/desktop`. Packaged for Windows first, then Linux.
- **Talks to:** RigApp server (loopback), GitHub releases.

## Seat tools (planned, M5)
- **What they do:** Hindsight memory, CodeGraph and a Playwright browser offered to seats through MCP, plus local models through any OpenAI-compatible server. Each is opt-in per pod with its token cost shown; nothing is added to a seat by default.
- **Talks to:** Hindsight at `http://localhost:8888`, the `codegraph` CLI, `@playwright/mcp`, a local model server. Seats in WSL reach Windows-side tools only with WSL mirrored networking (this PC uses the default NAT mode today).
