import { resolve } from "path";
import { defineConfig } from "electron-vite";

/**
 * Three renderer entry points, each its own transparent Electron window:
 *   - overlay   : the always-on-top hologram UI (chatbox, mic, buttons, emergency)
 *   - project3d : the Iron-Man-style 3D modeling space
 *   - wallpaper : the same 3D scene rendered behind the desktop icons (live wallpaper)
 */
export default defineConfig({
  main: {
    build: {
      lib: { entry: resolve(__dirname, "src/main/index.ts") },
      // `ws` has optional native add-ons (bufferutil, utf-8-validate). Bundling them inlines a
      // broken native binding → "TypeError: bufferUtil.mask is not a function" when the socket
      // sends its first frame. Externalize them so `ws` uses its pure-JS implementation; at
      // runtime require() throws (they aren't shipped) and `ws` falls back cleanly.
      rollupOptions: { external: ["electron", "bufferutil", "utf-8-validate"] },
    },
  },
  preload: {
    build: {
      lib: { entry: resolve(__dirname, "src/preload/index.ts") },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    build: {
      rollupOptions: {
        input: {
          overlay: resolve(__dirname, "src/renderer/overlay.html"),
          project3d: resolve(__dirname, "src/renderer/project3d.html"),
          wallpaper: resolve(__dirname, "src/renderer/wallpaper.html"),
        },
      },
    },
  },
});
