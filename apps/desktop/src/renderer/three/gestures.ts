import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { SceneManager } from "./SceneManager";

/**
 * Camera hand-tracking (requirement 4) — the "Tony Stark moving holograms" interaction.
 *
 *   - Pinch (thumb tip ↔ index tip close) grabs the object under the pinch point and drags
 *     it as the hand moves, mirroring the mouse drag path in SceneManager.
 *   - With two hands pinching, the change in distance between the hands scales the selected
 *     object (hands apart → enlarge, together → shrink).
 *
 * Both behaviours have independent on/off toggles (`drag`, `scale`) that can be flipped from
 * a button OR by voice command (requirement 4: "can be turned off by button or by voice").
 */
export class GestureController {
  private landmarker: HandLandmarker | null = null;
  private running = false;
  private raf = 0;
  enabled = false;
  drag = true;
  scale = true;

  private pinching = false;
  private lastTwoHandDist: number | null = null;

  constructor(
    private video: HTMLVideoElement,
    private scene: SceneManager,
  ) {}

  async enable(): Promise<void> {
    if (this.enabled) return;
    this.enabled = true;
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm",
    );
    this.landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      },
      numHands: 2,
      runningMode: "VIDEO",
    });
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    this.video.srcObject = stream;
    await this.video.play();
    this.running = true;
    this.loop();
  }

  disable(): void {
    this.enabled = false;
    this.running = false;
    cancelAnimationFrame(this.raf);
    const stream = this.video.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
    this.pinching = false;
    this.lastTwoHandDist = null;
  }

  private loop = (): void => {
    if (!this.running || !this.landmarker) return;
    const res = this.landmarker.detectForVideo(this.video, performance.now());
    const hands = res.landmarks ?? [];

    // Two-hand scale (requirement 4)
    if (this.scale && hands.length === 2) {
      const c0 = hands[0][9]; // middle-finger MCP ≈ palm center
      const c1 = hands[1][9];
      const dist = Math.hypot(c0.x - c1.x, c0.y - c1.y);
      if (this.lastTwoHandDist != null) {
        const ratio = dist / this.lastTwoHandDist;
        if (ratio > 0.01 && Number.isFinite(ratio)) this.scene.twoHandScale(ratio);
      }
      this.lastTwoHandDist = dist;
    } else {
      this.lastTwoHandDist = null;
    }

    // One-hand pinch drag (requirement 4)
    if (this.drag && hands.length >= 1) {
      const h = hands[0];
      const thumb = h[4];
      const index = h[8];
      const pinchDist = Math.hypot(thumb.x - index.x, thumb.y - index.y);
      // mirror x because the webcam is a selfie view
      const nx = 1 - (thumb.x + index.x) / 2;
      const ny = (thumb.y + index.y) / 2;
      if (pinchDist < 0.05) {
        if (!this.pinching) {
          this.scene.pinchGrabAt(nx, ny);
          this.pinching = true;
        } else {
          this.scene.pinchMoveTo(nx, ny);
        }
      } else if (this.pinching) {
        this.scene.pinchRelease();
        this.pinching = false;
      }
    }

    this.raf = requestAnimationFrame(this.loop);
  };
}
