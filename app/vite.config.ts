/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The IPS verifier for wallet credentials (src/populate/wallet.ts) sends no
// CORS headers, so the browser reaches it through this proxy.
const proxy = {
  "/ips-verifier": {
    target: "https://ips.digicredential.eu",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/ips-verifier/, ""),
  },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, proxy },
  preview: { proxy },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // The real-data UI tests render whole forms in jsdom; on a busy machine
    // they can take several seconds.
    testTimeout: 20_000,
  },
});
