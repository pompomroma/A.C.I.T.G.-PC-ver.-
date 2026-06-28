import * as THREE from "three";

export type ShapeKind =
  | "cube"
  | "sphere"
  | "cylinder"
  | "cone"
  | "torus"
  | "plane"
  | "tetrahedron"
  | "icosahedron";

/**
 * The Iron-Man / JARVIS style 3D modeling space (requirement 4).
 *
 * Interactions implemented here:
 *   - Left-click drag an object to move it (raycaster + a camera-facing drag plane).
 *   - Mouse wheel while pointing at an object enlarges/shrinks *that* object.
 *   - Drag on empty space orbits the camera; wheel on empty space dollies.
 *   - Clone / delete / select / reset via public methods (driven by the toolbar AND by
 *     voice/text commands relayed from the core).
 *
 * Gesture control (pinch-drag, two-hand scale) calls the same primitives, so camera-hand
 * input and mouse input are interchangeable (requirement 4).
 */
export class SceneManager {
  readonly scene = new THREE.Scene();
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private objects: THREE.Mesh[] = [];
  private selected: THREE.Mesh | null = null;

  // camera orbit state
  private spherical = new THREE.Spherical(9, Math.PI / 3, Math.PI / 4);
  private target = new THREE.Vector3(0, 0, 0);

  // drag state
  private dragging: THREE.Mesh | null = null;
  private dragPlane = new THREE.Plane();
  private dragOffset = new THREE.Vector3();
  private orbiting = false;
  private lastPointer = { x: 0, y: 0 };

  constructor(private canvas: HTMLCanvasElement, transparent = true) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: transparent,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000);
    this.setupLights();
    this.scene.add(this.grid());
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.bindMouse();
    this.updateCamera();
    this.animate();
  }

  // ── construction helpers ──────────────────────────────────────────────
  private setupLights(): void {
    this.scene.add(new THREE.AmbientLight(0x224455, 1.2));
    const key = new THREE.PointLight(0x41e8ff, 1.4, 100);
    key.position.set(6, 10, 6);
    this.scene.add(key);
  }

  private grid(): THREE.GridHelper {
    const g = new THREE.GridHelper(40, 40, 0x2a7e92, 0x123540);
    (g.material as THREE.Material).transparent = true;
    (g.material as THREE.Material).opacity = 0.35;
    return g;
  }

  // ── public API (toolbar + voice/text commands) ────────────────────────
  addShape(kind: ShapeKind): string {
    const geo = SceneManager.geometryFor(kind);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x35d6ef,
      emissive: 0x0a3a44,
      metalness: 0.35,
      roughness: 0.25,
      transparent: true,
      opacity: 0.85,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((Math.random() - 0.5) * 4, 1, (Math.random() - 0.5) * 4);
    mesh.userData.id = `obj_${Math.random().toString(36).slice(2, 8)}`;
    this.addWireframe(mesh);
    this.scene.add(mesh);
    this.objects.push(mesh);
    this.select(mesh.userData.id);
    return mesh.userData.id;
  }

  clone(id?: string): string | null {
    const src = id ? this.find(id) : this.selected;
    if (!src) return null;
    const mesh = src.clone();
    mesh.material = (src.material as THREE.Material).clone();
    mesh.position.x += 1.2;
    mesh.userData.id = `obj_${Math.random().toString(36).slice(2, 8)}`;
    this.scene.add(mesh);
    this.objects.push(mesh);
    this.select(mesh.userData.id);
    return mesh.userData.id;
  }

  remove(id: string): void {
    const m = this.find(id);
    if (!m) return;
    this.scene.remove(m);
    this.objects = this.objects.filter((o) => o !== m);
    if (this.selected === m) this.selected = null;
  }

  select(id: string): void {
    this.selected = this.find(id) ?? null;
    for (const o of this.objects) {
      const ring = o.getObjectByName("sel") as THREE.LineSegments | undefined;
      if (ring) ring.visible = o === this.selected;
    }
  }

  scaleSelected(factor: number): void {
    if (this.selected) this.selected.scale.multiplyScalar(factor);
  }

  reset(): void {
    for (const o of [...this.objects]) this.remove(o.userData.id);
  }

  // ── gesture entry points (requirement 4: camera hand control) ─────────
  /** Begin a pinch-grab at normalized screen coords (0..1). */
  pinchGrabAt(nx: number, ny: number): void {
    this.pointer.set(nx * 2 - 1, -(ny * 2 - 1));
    const hit = this.pick();
    if (hit) this.beginDrag(hit);
  }
  pinchMoveTo(nx: number, ny: number): void {
    this.pointer.set(nx * 2 - 1, -(ny * 2 - 1));
    this.moveDrag();
  }
  pinchRelease(): void {
    this.dragging = null;
  }
  /** Two-hand scale: ratio > 1 enlarges, < 1 shrinks the selected object. */
  twoHandScale(ratio: number): void {
    this.scaleSelected(ratio);
  }

  // ── internals ─────────────────────────────────────────────────────────
  private static geometryFor(kind: ShapeKind): THREE.BufferGeometry {
    switch (kind) {
      case "sphere":
        return new THREE.SphereGeometry(0.8, 32, 24);
      case "cylinder":
        return new THREE.CylinderGeometry(0.6, 0.6, 1.5, 32);
      case "cone":
        return new THREE.ConeGeometry(0.7, 1.4, 32);
      case "torus":
        return new THREE.TorusGeometry(0.7, 0.25, 16, 48);
      case "plane":
        return new THREE.PlaneGeometry(1.6, 1.6);
      case "tetrahedron":
        return new THREE.TetrahedronGeometry(0.9);
      case "icosahedron":
        return new THREE.IcosahedronGeometry(0.9);
      case "cube":
      default:
        return new THREE.BoxGeometry(1.2, 1.2, 1.2);
    }
  }

  private addWireframe(mesh: THREE.Mesh): void {
    const wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry),
      new THREE.LineBasicMaterial({ color: 0x9af6ff }),
    );
    wire.name = "sel";
    wire.visible = false;
    mesh.add(wire);
  }

  private find(id: string): THREE.Mesh | undefined {
    return this.objects.find((o) => o.userData.id === id);
  }

  private pick(): THREE.Mesh | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.objects, false);
    return hits.length ? (hits[0].object as THREE.Mesh) : null;
  }

  private beginDrag(mesh: THREE.Mesh): void {
    this.dragging = mesh;
    this.select(mesh.userData.id);
    const normal = this.camera.getWorldDirection(new THREE.Vector3()).negate();
    this.dragPlane.setFromNormalAndCoplanarPoint(normal, mesh.position);
    const hitPoint = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.dragPlane, hitPoint);
    this.dragOffset.copy(mesh.position).sub(hitPoint);
  }

  private moveDrag(): void {
    if (!this.dragging) return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hitPoint = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.dragPlane, hitPoint)) {
      this.dragging.position.copy(hitPoint.add(this.dragOffset));
    }
  }

  private bindMouse(): void {
    const el = this.canvas;
    const setPointer = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      this.pointer.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -(((e.clientY - r.top) / r.height) * 2 - 1),
      );
    };

    el.addEventListener("pointerdown", (e) => {
      setPointer(e);
      const hit = this.pick();
      if (hit) this.beginDrag(hit); // left-click drag object (requirement 4)
      else {
        this.orbiting = true;
        this.lastPointer = { x: e.clientX, y: e.clientY };
      }
    });
    window.addEventListener("pointermove", (e) => {
      if (this.dragging) {
        setPointer(e);
        this.moveDrag();
      } else if (this.orbiting) {
        const dx = (e.clientX - this.lastPointer.x) * 0.005;
        const dy = (e.clientY - this.lastPointer.y) * 0.005;
        this.spherical.theta -= dx;
        this.spherical.phi = THREE.MathUtils.clamp(this.spherical.phi + dy, 0.2, Math.PI - 0.2);
        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.updateCamera();
      }
    });
    window.addEventListener("pointerup", () => {
      this.dragging = null;
      this.orbiting = false;
    });

    // wheel: scale pointed object, else dolly camera (requirement 4)
    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        setPointer(e);
        const hit = this.pick();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        if (hit) {
          this.select(hit.userData.id);
          hit.scale.multiplyScalar(factor);
        } else {
          this.spherical.radius = THREE.MathUtils.clamp(
            this.spherical.radius * (e.deltaY < 0 ? 0.92 : 1.08),
            3,
            40,
          );
          this.updateCamera();
        }
      },
      { passive: false },
    );
  }

  private updateCamera(): void {
    const pos = new THREE.Vector3().setFromSpherical(this.spherical).add(this.target);
    this.camera.position.copy(pos);
    this.camera.lookAt(this.target);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    // Objects stay still until the user/AI moves them (drag, scroll-scale, gestures, clone).
    this.renderer.render(this.scene, this.camera);
  };
}
