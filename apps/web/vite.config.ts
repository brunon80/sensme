import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // sensme-wasm (web target) is initialized manually with its .wasm URL
  // (see src/engine/worker.ts); keep it out of dep pre-bundling.
  optimizeDeps: { exclude: ["sensme-wasm"] },
});
