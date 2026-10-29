import { execFile } from "node:child_process";
import { platform } from "./setup.ts";

// Windows' own folder picker, from PowerShell. A topmost owner form keeps it in front of
// RigApp's window instead of opening behind it.
const WINDOWS = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }",
  "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
  "$dialog.Description = 'Pick the folder this project works in'",
  "$dialog.ShowNewFolderButton = $true",
  "if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }",
].join("; ");

/** Opens the system's folder picker on this computer; answers the folder, or null if cancelled. */
export function pickFolder(): Promise<{ ok: boolean; path?: string | null; error?: string }> {
  const [cmd, args] =
    platform === "windows"
      ? ["powershell.exe", ["-NoProfile", "-STA", "-Command", WINDOWS]]
      : ["zenity", ["--file-selection", "--directory", "--title=Pick the folder this project works in"]];
  return new Promise((resolve) => {
    // Not windowsHide: that would hide the picker itself. PowerShell opens no console of its own here.
    execFile(cmd, args, { timeout: 10 * 60 * 1000 }, (err, stdout) => {
      const path = String(stdout).trim();
      if (path) resolve({ ok: true, path });
      else if (err && platform !== "windows" && (err as NodeJS.ErrnoException).code === "ENOENT")
        resolve({ ok: false, error: "No folder picker found (install zenity), so type the path instead." });
      else resolve({ ok: true, path: null });
    });
  });
}
