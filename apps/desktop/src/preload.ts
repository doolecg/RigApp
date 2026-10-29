import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge, UpdateState } from "../../../packages/contracts/src/index.ts";

// The main process passes the version in as an argument; a sandboxed preload cannot read package.json.
const version = process.argv.find((arg) => arg.startsWith("--rigapp-version="))?.slice("--rigapp-version=".length) ?? "";

const bridge: DesktopBridge = {
  version,
  getUpdate: () => ipcRenderer.invoke("rigapp:update:get"),
  onUpdate(listener) {
    const handler = (_event: unknown, state: UpdateState) => listener(state);
    ipcRenderer.on("rigapp:update", handler);
    return () => ipcRenderer.removeListener("rigapp:update", handler);
  },
  checkForUpdates: () => ipcRenderer.invoke("rigapp:update:check"),
  installUpdate: () => ipcRenderer.send("rigapp:update:install"),
};

contextBridge.exposeInMainWorld("rigapp", bridge);
