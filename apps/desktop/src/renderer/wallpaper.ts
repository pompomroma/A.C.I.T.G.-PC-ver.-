import { SceneManager, type ShapeKind } from "./three/SceneManager";

/**
 * Wallpaper-mode scene (requirement 17). Same 3D engine as the project window, rendered into
 * the window the main process reparents behind the desktop icons. It mirrors object commands
 * from the core so the live wallpaper reflects the project space, but it is non-interactive
 * (the window is focusable:false) so it never steals desktop clicks.
 */
const canvas = document.getElementById("scene") as HTMLCanvasElement;
const scene = new SceneManager(canvas, false);

for (const s of ["icosahedron", "torus", "sphere"] as ShapeKind[]) scene.addShape(s);

window.actig.onMessage((msg) => {
  if (msg.type !== "project3d") return;
  const cmd = msg.payload?.command;
  if (cmd?.action === "add") scene.addShape(cmd.shape);
  if (cmd?.action === "reset") scene.reset();
});
