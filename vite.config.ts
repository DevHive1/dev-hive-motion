import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
      // Finished MP4/GIF renders are served from here. Without proxying
      // this too, a download link to /renders/x.mp4 hits Vite's own dev
      // server (which has no such route) and falls back to index.html -
      // the empty HTML page instead of the actual video file.
      "/renders": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
