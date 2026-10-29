import { join } from "node:path";
import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
import type { ChildProcess } from "node:child_process";
import { startServer } from "./server.ts";
import { createUpdater } from "./updater.ts";

// Set before anything asks for userData, so the data folder is "RigApp" and not the package name.
app.setName("RigApp");

const BACKGROUND = "#141518";
let window: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.whenReady().then(main);
}

/** Plain-words page for when the server cannot start or stops. */
function showError(reason: string) {
  const escaped = reason.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const page = `<body style="background:${BACKGROUND};color:#e6e7ea;font:16px system-ui;padding:48px;max-width:640px">
<h1 style="font-size:22px">RigApp could not start its server</h1>
<p>Close RigApp and open it again. If this keeps happening, the details below help to find the cause.</p>
<pre style="white-space:pre-wrap;color:#c9cbd1">${escaped}</pre></body>`;
  void window?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
}

async function main() {
  Menu.setApplicationMenu(null);

  // The bundled server sits unpacked next to the asar (a child Node cannot import from inside it).
  const script = join(__dirname, "server.mjs").replace("app.asar", "app.asar.unpacked");
  const webDist = app.isPackaged ? join(process.resourcesPath, "web") : join(app.getAppPath(), "../web/dist");

  // Created hidden and shown without taking focus, so test runs open behind other windows.
  window = new BrowserWindow({
    title: "RigApp",
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: BACKGROUND,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--rigapp-version=${app.getVersion()}`],
    },
  });
  window.once("ready-to-show", () => window?.showInactive());
  window.on("closed", () => (window = null));

  // Links to other sites open in the browser, never inside RigApp.
  const external = (url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  };
  window.webContents.setWindowOpenHandler(({ url }) => {
    external(url);
    return { action: "deny" };
  });

  const updater = createUpdater((state) => window?.webContents.send("rigapp:update", state));
  ipcMain.handle("rigapp:update:get", () => updater.get());
  ipcMain.handle("rigapp:update:check", () => updater.check());
  ipcMain.on("rigapp:update:install", () => updater.install());

  try {
    const server = await startServer({
      script,
      webDist,
      dataDir: app.getPath("userData"),
      version: app.getVersion(),
      onCrash: showError,
    });
    serverProcess = server.child;
    // The page must come from this exact address: the server only accepts its own Origin on /ws.
    window.webContents.on("will-navigate", (event, url) => {
      if (!url.startsWith(server.url)) {
        event.preventDefault();
        external(url);
      }
    });
    await window.loadURL(server.url);
    updater.start();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

app.on("before-quit", () => {
  serverProcess?.kill();
});

app.on("window-all-closed", () => app.quit());
