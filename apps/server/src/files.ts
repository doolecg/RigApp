import { open, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { FileEntry } from "@rigapp/contracts";

// Big files are cut short; the Files tab is for a quick look, not an editor.
const READ_LIMIT = 200_000;

/** `inside` joined to the seat's folder, refusing anything that climbs out of it. */
function within(root: string, inside: string): string {
  const full = resolve(root, inside);
  const rel = relative(root, full);
  if (rel.startsWith("..") || resolve(root, rel) !== full) throw new Error("That path is outside the seat's folder.");
  return full;
}

export async function listFiles(root: string, inside: string): Promise<FileEntry[]> {
  const dir = within(root, inside);
  const names = await readdir(dir, { withFileTypes: true });
  const entries = await Promise.all(
    names.map(async (d) => {
      const isDir = d.isDirectory();
      const size = isDir ? 0 : await stat(join(dir, d.name)).then((s) => s.size, () => 0);
      return { name: d.name, dir: isDir, size };
    }),
  );
  return entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
}

export async function readText(root: string, inside: string): Promise<string> {
  const handle = await open(within(root, inside), "r");
  try {
    const buffer = Buffer.alloc(READ_LIMIT);
    const { bytesRead } = await handle.read(buffer, 0, READ_LIMIT, 0);
    const bytes = buffer.subarray(0, bytesRead);
    // A NUL byte in the first part means it is not text.
    if (bytes.subarray(0, 8000).includes(0)) return "This file is not text, so RigApp does not show it.";
    const size = (await handle.stat()).size;
    const text = bytes.toString("utf8");
    return size > READ_LIMIT ? `${text}\n\n… cut short: the file is ${Math.round(size / 1024)} KB` : text;
  } finally {
    await handle.close();
  }
}
