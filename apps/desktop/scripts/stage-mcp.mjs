// Copies Playwright MCP and the one package it needs into stage/mcp/packages, so the installer can carry
// them as plain files. pnpm keeps packages behind symlinks, which electron-builder cannot follow
// reliably, and the server is bundled into one file that cannot hold them.
import { cpSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// Not named node_modules: electron-builder leaves such folders out of extraResources. The server
// points NODE_PATH at this folder instead, which is how cli.js finds playwright-core.
const out = join(here, "..", "stage", "mcp", "packages");
const fromServer = createRequire(join(here, "..", "..", "server", "package.json"));

const mcp = realpathSync(dirname(fromServer.resolve("@playwright/mcp/package.json")));
// playwright-core sits beside @playwright/mcp in pnpm's store; cli.js finds it by walking up.
const core = realpathSync(join(mcp, "..", "..", "playwright-core"));

rmSync(join(here, "..", "stage", "mcp"), { recursive: true, force: true });
mkdirSync(join(out, "@playwright"), { recursive: true });
cpSync(mcp, join(out, "@playwright", "mcp"), { recursive: true, filter: (path) => !relative(mcp, path).startsWith("node_modules") });
// The type definitions are only for editors.
cpSync(core, join(out, "playwright-core"), { recursive: true, filter: (path) => !path.endsWith("types") });
console.log(`Staged Playwright MCP from ${mcp}`);
