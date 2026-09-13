/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: ["es2022", "chrome110", "edge110", "safari16"],
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.includes("node_modules/jspdf") || id.includes("node_modules/html2canvas") || id.includes("node_modules/dompurify")) return "pdf";
          if (id.includes("node_modules/exceljs")) return "xlsx";
          if (id.includes("node_modules/react") || id.includes("node_modules/zustand") || id.includes("node_modules/@radix-ui") || id.includes("node_modules/lucide-react")) return "vendor";
          return undefined;
        },
      },
    },
  },
  test: { environment: "jsdom", include: ["src/**/*.test.ts", "src/**/*.test.tsx"] },
}));
