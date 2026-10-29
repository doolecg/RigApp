import { defineConfig } from "vite";

// One config, three builds picked by --mode. Everything is bundled into one file each so the
// installer needs no node_modules (pnpm's symlinks make packaging them unreliable).
// Only `electron` stays external (it is built in) along with Node's own modules.
const builds = {
  // The RigApp server, run by Electron's own Node. Plain ESM because the server uses top-level await.
  server: { entry: "../server/src/bin.ts", format: "es", file: "server.mjs", clean: true },
  main: { entry: "src/main.ts", format: "cjs", file: "main.cjs", clean: false },
  preload: { entry: "src/preload.ts", format: "cjs", file: "preload.cjs", clean: false },
} as const;

export default defineConfig(({ mode }) => {
  const build = builds[mode as keyof typeof builds];
  if (!build) throw new Error(`Use --mode server, main or preload (got "${mode}")`);
  return {
    ssr: { noExternal: true, target: "node" },
    build: {
      ssr: build.entry,
      outDir: "dist",
      emptyOutDir: build.clean,
      minify: false,
      sourcemap: false,
      rollupOptions: {
        external: ["electron"],
        output: { format: build.format, entryFileNames: build.file },
      },
    },
  };
});
