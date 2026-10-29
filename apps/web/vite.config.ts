import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Dev: the UI runs on 7481 and proxies /ws to the RigApp server on 7480.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 7481,
    strictPort: true,
    proxy: { "/ws": { target: "ws://127.0.0.1:7480", ws: true } },
  },
});
