import {
  CanvasTexture,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';

const m = new Matrix4();
const q = new Quaternion();
const p = new Vector3();
const s = new Vector3();
const up = new Vector3(0, 1, 0);

/**
 * A soft dark footprint under each car: the contact shadow where the shadow map is off (Lite) or
 * only covers the player's car (Mobile), and a little ambient occlusion everywhere. One instanced
 * draw for every car.
 */
export class ContactShadows {
  readonly mesh: InstancedMesh;
  private readonly texture: CanvasTexture;
  private count = 0;

  constructor(capacity: number, opacity: number) {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size * 2;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // An elongated blob, darkest under the floor, fading out past the wheels.
      const g = ctx.createRadialGradient(size / 2, size, 2, size / 2, size, size / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.55, 'rgba(255,255,255,0.75)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.setTransform(1, 0, 0, 2, 0, -size);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size * 2);
    }
    this.texture = new CanvasTexture(canvas);
    const material = new MeshBasicMaterial({
      color: 0x000000,
      alphaMap: this.texture,
      transparent: true,
      opacity,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const geometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.name = 'contact-shadows';
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.count = 0;
  }

  begin(): void {
    this.count = 0;
  }

  /** A car at ground height `y`, centre (x, z) and yaw: footprint 2.3 m wide, 5.2 m long. */
  add(x: number, y: number, z: number, yaw: number): void {
    if (this.count >= this.mesh.instanceMatrix.count) return;
    q.setFromAxisAngle(up, yaw + Math.PI / 2);
    m.compose(p.set(x, y + 0.01, z), q, s.set(2.3, 1, 5.2));
    this.mesh.setMatrixAt(this.count++, m);
  }

  end(): void {
    this.mesh.count = this.count;
    this.mesh.visible = this.count > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.texture.dispose();
    this.mesh.dispose();
    this.mesh.removeFromParent();
  }
}
