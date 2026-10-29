# RigApp build prompt

Paste everything below the line into a fresh Claude Code session opened in `E:\REPOS\AI TOOLS\RigApp`.

---

You are building **RigApp**: a modern desktop and web control surface for **OpenRig**. It works like T3 Code (a local server that drives agent harnesses, with a React UI and an Electron shell), but its only driver is the OpenRig daemon. It organises work like Claude Code Projects: one project holds a lead conversation plus parallel threads. The folder is empty and is not a git repo yet.

## 0. Read first (sources of truth)

Before you design anything, clone these read-only into `E:\REPOS\AI TOOLS\RigApp\.ref\` (add `.ref/` to `.gitignore`) and study them:

1. https://github.com/mvschwarz/openrig is the driver. Read the daemon's Hono routes, its MCP tools, the CLI (`rig up/down/send`, seat inspection, snapshots), the RigSpec, AgentSpec and CULTURE.md formats, and how seat output and activity are surfaced (the activity hooks at `/api/activity/hooks`, any SSE or WebSocket streams, and harness transcripts). Also read the old React web UI and `openrig-tui` to see which endpoints they call. **Never invent an endpoint. Every call RigApp makes must point to a route you found in the source.** If something RigApp needs has no route, list it in `docs/systems.md` under "OpenRig gaps" and use the CLI for it in the meantime.
2. https://github.com/pingdotgg/t3code is the model for the app's layout, monorepo, server and web split, Electron shell, event streaming, approvals, keybinds and settings. Copy its patterns, not its code where licences differ. Credit it in the README.
3. https://code.claude.com/docs/en/claude-projects is the model for Projects. Copy the lead conversation, the threads it starts, the Overview of what needs you, standing project instructions, approvals, and the pause, archive and delete actions.
4. https://github.com/shadcn-ui/ui is the component library (Tailwind v4 and Radix through the shadcn CLI).

Write down what you found in `docs/systems.md`: the daemon API surface, how output is streamed, and the gaps. Then plan.

## 1. Fixed decisions (do not reopen)

- **Platform:** a TypeScript pnpm monorepo with `apps/server` (Node, talks to the OpenRig daemon), `apps/web` (React, Vite, shadcn, Tailwind) and `apps/desktop` (Electron, loads the local web app). The layout follows T3 Code.
- **Windows:** OpenRig needs tmux, so the daemon runs in **WSL2**. On startup the server finds the daemon (its port or socket, reachable from Windows through WSL localhost) and shows a clear setup screen when WSL, OpenRig or the daemon is missing. That screen gives exact steps, and RigApp never installs anything silently. The RigApp server itself runs on Windows.
- **Mapping:** **Project = rig. Thread = seat.**
  - The sidebar lists projects (rigs: running, stopped, or snapshotted). Each project shows its seats underneath as threads, grouped by pod.
  - Every project has a **lead seat**, which is the project's main conversation, like the Claude Projects lead. You type there, and it hands out work to other seats through OpenRig's normal messaging.
  - Opening any thread gives you a direct chat with that seat. You can send messages to it, interrupt it, and see its status.
  - **Overview** lists every seat that needs you: waiting on approval, blocked, finished with output to review, or errored.
  - **Project instructions** map onto the rig's CULTURE.md and pod guidance.
- **Harnesses:** show whichever harness each seat runs (Claude Code, Codex or Pi) with a small label. RigApp does not talk to the harness directly. Everything goes through OpenRig.

## 2. v1 scope (all four, built as milestones in this order)

**M1. Projects and threads chat (foundation)**
- The monorepo, the server's link to the daemon, and the WSL detection and setup screen.
- A T3-style three-part layout: a resizable sidebar (projects with threads, search, a New project button), a main chat column, and a right panel that can be collapsed (seat details, files, and later the terminal and graph).
- A chat view that streams the seat's messages, collapsible tool-call cards, diffs, approval prompts with approve and deny, an interrupt button, a status dot per thread (idle, working, waiting, error), and unread markers.
- A composer with multiline input, `@seat` mentions to direct a message, slash commands for rig actions, attachments if OpenRig supports them, and Enter to send with Shift+Enter for a new line.
- The Overview page, plus a command palette on Ctrl+K for every action.

**M2. Rig topology graph and a live terminal per seat**
- A graph tab using React Flow (`@xyflow/react`, only after I approve the dependency): pods as groups, seats as nodes, edges from the RigSpec, and live status colours. Clicking a node opens that thread.
- A terminal tab: the seat's tmux pane through xterm.js, attached read-only by default, with an explicit "Take control" toggle. Use whichever pane capture or attach route OpenRig exposes. If none exists, record it as a gap and use the CLI in the meantime.

**M3. Spec and culture editor, rig lifecycle**
- Create and edit RigSpec, AgentSpec and CULTURE.md with Monaco or CodeMirror (ask which first). Validate against OpenRig's own schema or validator, and show a diff before saving.
- Rig up and down, snapshot and restore, adopting existing tmux sessions, and importing and exporting RigBundles.
- Show a confirmation before anything destructive (rig down without a snapshot, deleting a spec).

**M4. Desktop polish and release**
- Electron windows open behind the active window when testing (`showInactive()`).
- Auto-update from GitHub releases: check at startup and every few hours, download in the background, offer to install, and include a Check for updates button with release notes rendered as Markdown.
- A Settings page with every option applied live and saved, keybinds that can be rebound, theme, daemon address, and the notice (see below).
- Package for Windows first.

Finish each milestone fully (build, run, screenshot, tests) before starting the next.

## 3. Look and feel

- Modern AI-tool look in the style of T3 Code, Claude and Linear: dense, calm and dark by default with a light theme too. Built only from shadcn components and lucide icons.
- Follow my global anti-slop UI rules: one ground, one ink, one accent; one typeface for UI with monospace only for code and terminals; no gradients, glows, glass, resting shadows, pill badges above headings, emoji, or rows of identical cards; surfaces separated by tone steps, not hairlines.
- Before designing, recall the `design::general` Hindsight bank as described in my CLAUDE.md and follow it.
- Screenshot every main screen headless with Playwright at 1440×900 and at 390×844 (the phone width, because remote access from a phone comes later).

## 4. Project setup and rules

- `git init`, branch `dev-0.1.0`, and the identity doolecg <doolecg@gmail.com>. No AI attribution anywhere. Commit only when I ask.
- Apply the project kit from `C:\Users\doole\.claude\project-kit\`: `CLAUDE.md`, `docs/bible.html`, `docs/design.md`, `docs/systems.md`, and one `docs/milestone-N-guide.html` per milestone above.
- Add a `LICENSE` (MIT, check that it fits the licences of OpenRig and T3 Code), a README Disclaimer section, and the same short notice in Settings and About, using the wording from `C:\Users\doole\.claude\disclaimer-template.md`. Show the notice before risky actions (taking control of a terminal, rig down, deleting specs).
- Two IntelliJ run configs in `.run/`: **Main Run** and **Dev Run**, as set out in my CLAUDE.md.
- Ask before adding any dependency beyond the core stack (React, Vite, Tailwind, shadcn and Radix, Electron, a Node HTTP server, Vitest, Playwright). Free and open source only.
- No secrets in source. If any are needed, they go in a repo-root `.env` that is git-ignored before it is created.
- RigApp makes no network calls apart from to the local OpenRig daemon and the GitHub releases check.

## 5. How to work

- Plan in 2 or 3 lines per milestone, each step with its own check. Then build.
- Tests: Vitest for the server's daemon client (with recorded real responses, not invented ones) and Playwright for the UI flows: create a project, open a thread, send a message, approve a prompt, open the graph, attach the terminal.
- Verify against a **real** OpenRig rig in WSL. If the daemon isn't reachable, stop and tell me the exact setup steps. Never fake streaming or seat data to make the UI look done.
- At most 3 test or fix passes on any one problem, then stop and ask me.
- Machine limits: at most 3 subagents, only one pnpm build or test run at a time, check CPU before builds (wait if it is above 70%), dev server on one fixed port only, and stop it by PID. Put these limits in every subagent brief.
- At the end of each milestone, report the path to run the app, what was verified, what wasn't, screenshots, and any OpenRig gaps found.

Start with step 0.
