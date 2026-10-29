// Saves real daemon responses as test fixtures. Run with the daemon up:
//   pnpm --filter @rigapp/server record-fixtures
import { writeFile } from "node:fs/promises";

const base = process.env.RIGAPP_DAEMON_URL ?? "http://127.0.0.1:7433";

async function get(path: string): Promise<unknown> {
  const res = await fetch(base + path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function save(name: string, data: unknown): Promise<void> {
  const file = new URL(`../test/fixtures/${name}.json`, import.meta.url);
  await writeFile(file, JSON.stringify(data, null, 2) + "\n");
  console.log("saved", name);
}

const ps = (await get("/api/ps")) as { rigId: string; name: string }[];
await save("ps", ps);
for (const rig of ps) {
  await save(`rig-${rig.name}`, await get(`/api/rigs/${rig.rigId}`));
  await save(`nodes-${rig.name}`, await get(`/api/rigs/${rig.rigId}/nodes`));
}
