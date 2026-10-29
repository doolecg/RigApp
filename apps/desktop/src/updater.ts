// Auto-update from GitHub releases, after Operant's updater: check at start and every few hours,
// download in the background, tell the page, and install when the user clicks (or the app quits).
import { app } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";
import type { UpdateState } from "../../../packages/contracts/src/index.ts";

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

/** GitHub sends notes as one string, or as a list when several versions were skipped. */
function notesOf(info: UpdateInfo): string | undefined {
  const notes = info.releaseNotes;
  if (!notes) return undefined;
  return typeof notes === "string" ? notes : notes.map((n) => `## ${n.version}\n\n${n.note ?? ""}`).join("\n\n");
}

export function createUpdater(send: (state: UpdateState) => void) {
  let state: UpdateState = { status: "idle" };
  const set = (next: UpdateState) => {
    state = next;
    send(state);
  };

  // A development run has no installer to replace, so there is nothing to check.
  if (!app.isPackaged) {
    state = { status: "none" };
    return { get: () => state, check: async () => {}, install: () => {}, start: () => {} };
  }

  autoUpdater.setFeedURL({ provider: "github", owner: "doolecg", repo: "RigApp" });
  autoUpdater.autoDownload = true;
  // A downloaded update installs on the next quit even if the user never clicks the banner.
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => set({ status: "checking" }));
  autoUpdater.on("update-available", (info) => set({ status: "downloading", version: info.version, notes: notesOf(info), percent: 0 }));
  autoUpdater.on("update-not-available", () => set({ status: "none" }));
  autoUpdater.on("download-progress", (p) => set({ ...state, status: "downloading", percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (info) => set({ status: "ready", version: info.version, notes: notesOf(info) }));
  // A repo with no published release answers 404: that means there is nothing newer, not a failure.
  autoUpdater.on("error", (error) =>
    set(/\b404\b/.test(error.message) ? { status: "none" } : { status: "error", error: error.message }),
  );

  const check = async () => {
    // A finished download stays on offer; checking again would only restart it.
    if (state.status === "checking" || state.status === "downloading" || state.status === "ready") return;
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      // The "error" event above already told the page.
    }
  };

  return {
    get: () => state,
    check,
    install: () => autoUpdater.quitAndInstall(),
    start: () => {
      void check();
      setInterval(() => void check(), CHECK_EVERY_MS).unref();
    },
  };
}
