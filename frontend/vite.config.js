import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// FastAPI backend. Everything except the React app itself is proxied to it, so the
// frontend can call relative URLs (/api/..., /auth/login) in dev and in production.
const BACKEND = process.env.BACKEND_URL || "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api/": BACKEND,
      "/auth/": BACKEND,
      "/uploads/": BACKEND,
      "/webhook": BACKEND,
      "/healthz": BACKEND,
      "/app-review-guide.html": BACKEND,
      "/api-docs.html": BACKEND,
    },
  },
});
