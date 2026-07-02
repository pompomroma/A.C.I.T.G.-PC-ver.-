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

// Small status line so camera failures are visible instead of silent.
const status = document.createElement("div");
status.id = "cam-status";
status.style.cssText =
  "position:fixed;left:50%;bottom:64px;transform:translateX(-50%);padding:6px 14px;border-radius:999px;font:13px/1.4 system-ui;color:#d8fbff;background:rgba(8,26,36,.7);border:1px solid rgba(138,246,255,.35);display:none;max-width:80vw;text-align:center";
document.body.appendChild(status);
function showStatus(msg: string, ms = 6000): void {
  status.textContent = msg;
  status.style.display = msg ? "block" : "none";
  if (msg && ms) setTimeout(() => (status.style.display = "none"), ms);
}

async function enableCamera(): Promise<void> {
  camBtn.textContent = "camera: …";
  showStatus("Starting camera…", 0);
  await gestures.enable();
  camBtn.textContent = "camera: on";
  camBtn.classList.add("on");
  showStatus("Camera on — pinch to drag, two hands to scale.");
}

function disableCamera(): void {
  gestures.disable();
  camBtn.textContent = "camera: off";
  camBtn.classList.remove("on");
  showStatus("");
}

function cameraError(e: unknown): void {
  camBtn.textContent = "camera: error";
  camBtn.classList.remove("on");
  const m = (e as any)?.message || String(e);
  const hint = /denied|permission|notallowed/i.test(m)
    ? " — allow camera access for ACTIG in Windows Settings → Privacy → Camera."
    : /network|fetch|load/i.test(m)
      ? " — the hand-tracking model needs internet on first use."
      : "";
  showStatus("Camera couldn't start: " + m + hint, 12000);
}

// camera gesture toggles (button + voice)
const camBtn = button("camera: off", async () => {
  try {
    if (gestures.enabled) disableCamera();
    else await enableCamera();
  } catch (e) {
    cameraError(e);
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
    try {
      if (p.enabled === true && !gestures.enabled) await enableCamera();
      if (p.enabled === false && gestures.enabled) disableCamera();
    } catch (e) {
      cameraError(e);
    }
  }
});

// a couple of starter shapes so the space isn't empty
scene.addShape("cube");
scene.addShape("torus");
