import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    // The dashboard's source map is uploaded with the rest of dist/, which
    // hands anyone who opens devtools the exact admin write surface that
    // `openapi_url=None` was set to keep off the classroom network.
    sourcemap: false,
    target: "esnext",
  },
});
