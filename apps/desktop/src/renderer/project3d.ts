import { GestureController } from "./three/gestures";
import { SceneManager, type ShapeKind } from "./three/SceneManager";

/**
 * 3D project window bootstrap. Builds the in-scene hologram toolbar (requirement 5: in-3D
 * buttons for every function) and relays core commands so the same actions work by voice or
 * text (requirements 4, 14, 16). Camera hand-tracking has button + voice toggles
 * (requirement 4).
 */
const canvas = document.getElementById("scene") as HTMLCanvasElement;
const video = document.getElementById("cam") as HTMLVideoElement;
const toolbar = document.getElementById("toolbar") as HTMLDivElement;

const scene = new SceneManager(canvas, true);
const gestures = new GestureController(video, scene);

const SHAPES: ShapeKind[] = [
  "cube",
  "sphere",
  "cylinder",
  "cone",
  "torus",
  "plane",
  "tetrahedron",
  "icosahedron",
];

function button(label: string, onClick: () => void, id?: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  if (id) b.id = id;
  b.onclick = onClick;
  toolbar.appendChild(b);
  return b;
}

// shape buttons
for (const s of SHAPES) button(s, () => scene.addShape(s));
// object ops
button("clone", () => scene.clone());
button("delete", () => {
  const id = (scene as any).selected?.userData?.id;
  if (id) scene.remove(id);
});
button("reset", () => scene.reset());

// camera gesture toggles (button + voice)
const camBtn = button("camera: off", async () => {
  if (gestures.enabled) {
    gestures.disable();
    camBtn.textContent = "camera: off";
    camBtn.classList.remove("on");
  } else {
    await gestures.enable();
    camBtn.textContent = "camera: on";
    camBtn.classList.add("on");
  }
});
button("close", () => window.actig.closeProject3D());

/** Apply a project3d command coming from the core (voice/text). */
function applyCommand(cmd: any): void {
  switch (cmd?.action) {
    case "add":
      scene.addShape(cmd.shape as ShapeKind);
      break;
    case "clone":
      scene.clone(cmd.targetId);
      break;
    case "delete":
      scene.remove(cmd.targetId);
      break;
    case "select":
      scene.select(cmd.targetId);
      break;
    case "reset":
      scene.reset();
      break;
    case "close":
      window.actig.closeProject3D();
      break;
  }
}

window.actig.onMessage(async (msg) => {
  if (msg.type === "project3d") applyCommand(msg.payload?.command);
  if (msg.type === "camera_gesture") {
    const p = msg.payload || {};
    if (typeof p.drag === "boolean") gestures.drag = p.drag;
    if (typeof p.scale === "boolean") gestures.scale = p.scale;
    if (p.enabled === true && !gestures.enabled) {
      await gestures.enable();
      camBtn.textContent = "camera: on";
      camBtn.classList.add("on");
    }
    if (p.enabled === false && gestures.enabled) {
      gestures.disable();
      camBtn.textContent = "camera: off";
      camBtn.classList.remove("on");
    }
  }
});

// a couple of starter shapes so the space isn't empty
scene.addShape("cube");
scene.addShape("torus");
