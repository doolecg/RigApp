import { readFile } from "node:fs/promises";
import type { ClientMessage, LibrarySpec, SearchHit, SnapshotInfo, SpecFile, UsageWindow } from "@rigapp/contracts";
import type { Hub } from "./hub.ts";

type Request = Extract<
  ClientMessage,
  {
    method:
      | "specs.load"
      | "specs.validate"
      | "specs.save"
      | "rig.up"
      | "rig.down"
      | "rig.snapshots"
      | "rig.snapshot"
      | "rig.restore"
      | "library"
      | "up.spec"
      | "usage"
      | "search";
  }
>;
export type LifecycleMethod = Request["method"];
export interface Answer {
  ok: boolean;
  error?: string;
  data?: unknown;
}

/** One daemon call. The body is JSON, or text when `text` is set (the spec validator wants raw YAML). */
async function call(url: string, method: string, path: string, body?: unknown, text = false, sender?: string | null) {
  const res = await fetch(url + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": text ? "text/yaml" : "application/json" }),
      ...(sender ? { "x-openrig-session": sender } : {}),
    },
    body: body === undefined ? undefined : text ? String(body) : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const raw = await res.text();
  let json: unknown = raw;
  try {
    json = JSON.parse(raw);
  } catch {
    // YAML or plain text answers stay as text.
  }
  return { ok: res.ok, status: res.status, json, raw, headers: res.headers };
}

function failure(json: unknown, status: number): string {
  const body = json as { error?: string; message?: string; reason?: string; errors?: string[] } | string;
  if (typeof body === "string") return body.slice(0, 300) || `OpenRig answered ${status}.`;
  return body?.message ?? body?.errors?.join("; ") ?? body?.error ?? body?.reason ?? `OpenRig answered ${status}.`;
}

/**
 * The rig's spec and culture files. Files under one of the daemon's files roots are read
 * and saved through `/api/files/*`; anything else (built-in specs) is shown read-only.
 */
async function loadSpecs(url: string, hub: Hub, rigId: string): Promise<SpecFile[]> {
  const exported = await call(url, "GET", `/api/rigs/${rigId}/spec`);
  if (!exported.ok) throw new Error(failure(exported.json, exported.status));
  const rigRoot = decodeURIComponent(exported.headers.get("x-rig-root") ?? "");
  const roots = ((await call(url, "GET", "/api/files/roots")).json as { roots?: { name: string; path: string }[] }).roots ?? [];
  const root = roots.find((r) => rigRoot.startsWith(`${r.path}/`));
  const files: SpecFile[] = [];
  for (const name of ["rig.yaml", "CULTURE.md"] as const) {
    if (root) {
      const path = `${rigRoot.slice(root.path.length + 1)}/${name}`;
      const read = await call(url, "GET", `/api/files/read?root=${encodeURIComponent(root.name)}&path=${encodeURIComponent(path)}`);
      const file = read.json as { content?: string; mtime?: string; contentHash?: string };
      if (read.ok && typeof file.content === "string") {
        files.push({ name, content: file.content, editable: true, root: root.name, path, mtime: file.mtime, hash: file.contentHash });
        continue;
      }
    }
    const why = "This file is outside OpenRig's files roots (set OPENRIG_FILES_ALLOWLIST to edit it), so it is read-only here.";
    if (name === "rig.yaml") files.push({ name, content: exported.raw, editable: false, reason: why });
    else {
      const text = await readFile(hub.localPath(`${rigRoot}/${name}`), "utf8").catch(() => null);
      if (text !== null) files.push({ name, content: text, editable: false, reason: why });
    }
  }
  return files;
}

export async function lifecycle(hub: Hub, request: Request): Promise<Answer> {
  const url = hub.url;
  try {
    switch (request.method) {
      case "specs.load":
        return { ok: true, data: await loadSpecs(url, hub, request.rigId) };
      case "specs.validate": {
        const r = await call(url, "POST", "/api/rigs/import/validate", request.content, true);
        const body = r.json as { valid?: boolean; errors?: string[] };
        return { ok: true, data: { valid: !!body.valid, errors: body.errors ?? [] } };
      }
      case "specs.save": {
        // OpenRig records who wrote a file; RigApp writes as the rig's terminal seat, the human.
        const human = hub.projects().find((p) => p.id === request.rigId)?.human;
        const r = await call(
          url,
          "POST",
          "/api/files/write",
          {
            root: request.root,
            path: request.path,
            content: request.content,
            expectedMtime: request.mtime,
            expectedContentHash: request.hash,
            ...(human ? {} : { actor: "rigapp" }),
          },
          false,
          human,
        );
        if (r.status === 409) return { ok: false, error: "The file changed on disk since you opened it. Reload it, then make your change again." };
        return r.ok ? { ok: true } : { ok: false, error: failure(r.json, r.status) };
      }
      case "rig.up": {
        const r = await call(url, "POST", `/api/rigs/${request.rigId}/up`, request.plan ? { plan: true } : {});
        hub.nudge();
        return r.ok ? { ok: true, data: r.json } : { ok: false, error: failure(r.json, r.status), data: r.json };
      }
      case "up.spec": {
        const r = await call(url, "POST", "/api/up", {
          sourceRef: request.sourceRef,
          plan: request.plan,
          cwdOverride: request.cwd,
          rigName: request.rigName,
          ...(request.plan ? {} : { autoApprove: true }),
        });
        hub.nudge();
        return r.ok ? { ok: true, data: r.json } : { ok: false, error: failure(r.json, r.status), data: r.json };
      }
      case "rig.down": {
        const r = await call(url, "POST", "/api/down", { rigId: request.rigId, snapshot: request.snapshot });
        hub.nudge();
        return r.ok ? { ok: true, data: r.json } : { ok: false, error: failure(r.json, r.status) };
      }
      case "rig.snapshots": {
        const r = await call(url, "GET", `/api/rigs/${request.rigId}/snapshots`);
        if (!r.ok) return { ok: false, error: failure(r.json, r.status) };
        const list = (r.json as { id: string; kind: string; status: string; createdAt: string }[]).map(
          ({ id, kind, status, createdAt }): SnapshotInfo => ({ id, kind, status, createdAt }),
        );
        return { ok: true, data: list };
      }
      case "rig.snapshot": {
        const r = await call(url, "POST", `/api/rigs/${request.rigId}/snapshots`, { kind: "manual" });
        hub.nudge();
        return r.ok ? { ok: true } : { ok: false, error: failure(r.json, r.status) };
      }
      case "rig.restore": {
        const r = await call(url, "POST", `/api/rigs/${request.rigId}/restore/${request.snapshotId}`, {});
        hub.nudge();
        return r.ok ? { ok: true, data: r.json } : { ok: false, error: failure(r.json, r.status) };
      }
      case "library": {
        const r = await call(url, "GET", "/api/specs/library");
        const all = (r.json as (LibrarySpec & { kind: string })[]) ?? [];
        return { ok: true, data: all.filter((s) => s.kind === "rig").map(({ id, name, version, summary, sourcePath }) => ({ id, name, version, summary, sourcePath })) };
      }
      case "usage": {
        const r = await call(url, "GET", "/api/provider/usage");
        const hosts = (r.json as { hostUsage?: { provider: string; windows: (UsageWindow & { asOf: string })[] }[] }).hostUsage ?? [];
        // Each seat reports the same account windows; keep the newest reading of each.
        const newest = new Map<string, UsageWindow>();
        for (const host of hosts)
          for (const w of host.windows) {
            const key = `${host.provider}:${w.window}`;
            const seen = newest.get(key);
            if (!seen || w.asOf > seen.asOf) newest.set(key, { provider: host.provider, window: w.window, usedPercent: w.usedPercent, resetsAt: w.resetsAt, asOf: w.asOf });
          }
        return { ok: true, data: [...newest.values()] };
      }
      case "search": {
        const seats = hub.allSeats();
        const hits = await Promise.all(
          seats.map(async (seat): Promise<SearchHit[]> => {
            const r = await call(url, "GET", `/api/transcripts/${encodeURIComponent(seat.session)}/grep?pattern=${encodeURIComponent(request.pattern)}`);
            const matches = r.ok ? ((r.json as { matches?: string[] }).matches ?? []) : [];
            return matches.slice(-5).map((line) => ({ session: seat.session, logicalId: seat.logicalId, line: line.trim() }));
          }),
        );
        return { ok: true, data: hits.flat().slice(0, 60) };
      }
    }
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
