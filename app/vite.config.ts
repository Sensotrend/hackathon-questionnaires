/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // The real-data UI tests render whole forms in jsdom; on a busy machine
    // they can take several seconds.
    testTimeout: 20_000,
  },
});
