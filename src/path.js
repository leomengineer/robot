// Planned-route line: a dotted glowing trail with rounded corners and an arrowhead.
// Dots and glow are instanced (two draw calls total), so rebuilding it on every edit is cheap.
import * as THREE from "three";

const SPACING = 0.1; // distance between dots, in cells
const CORNER_RADIUS = 0.3; // rounded turns
const START_GAP = 0.32; // leave the robot's own cell clear
const ARROW_TIP = 0.12; // arrowhead tip, measured from its origin
const TARGET_GAP = 0.5; // when the route ends on a battery, stop at the cell edge so the arrow stays visible
const MAX_DOTS = 400;

const CORE = new THREE.Color(0xeafeff); // near-white dot core
const TINT = new THREE.Color(0x7fefff); // cyan between flow pulses
const GLOW = 0x35dff2;

function glowTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.35, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function arrowGeometry() {
  // Flat arrowhead pointing +Z, lying on the floor
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.12);
  shape.lineTo(-0.17, -0.08);
  shape.lineTo(-0.06, -0.08);
  shape.lineTo(-0.06, -0.16);
  shape.lineTo(0.06, -0.16);
  shape.lineTo(0.06, -0.08);
  shape.lineTo(0.17, -0.08);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: false });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, 0.035, 0);
  return geometry;
}

export class PathLine {
  constructor(parent) {
    this.group = new THREE.Group();
    parent.add(this.group);

    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTexture(),
      color: GLOW,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glowGeo = new THREE.PlaneGeometry(0.3, 0.3).rotateX(-Math.PI / 2);
    this.glow = new THREE.InstancedMesh(glowGeo, glowMat, MAX_DOTS);
    this.glow.position.y = 0.006;
    this.glow.renderOrder = 1;

    this.dots = new THREE.InstancedMesh(new THREE.BoxGeometry(0.075, 0.02, 0.075), new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_DOTS);
    this.dots.position.y = 0.012;
    this.dots.setColorAt(0, CORE);

    this.arrow = new THREE.Mesh(arrowGeometry(), new THREE.MeshBasicMaterial({ color: CORE }));
    this.arrowGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62).rotateX(-Math.PI / 2), glowMat);
    this.arrowGlow.position.y = 0.006;

    for (const mesh of [this.glow, this.dots, this.arrow, this.arrowGlow]) {
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    this.distances = [];
    this.hide();
  }

  hide() {
    this.group.visible = false;
    this.distances = [];
  }

  // points: world positions (Vector3) of the cell centres along the route.
  // endsOnTarget: the last cell holds something (battery) the arrow should point at, not cover.
  show(points, { endsOnTarget = false } = {}) {
    const samples = this.sample(points, endsOnTarget ? TARGET_GAP : ARROW_TIP);
    if (!samples) return this.hide();
    const { dots, end, direction } = samples;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);

    dots.forEach(({ position, tangent }, i) => {
      q.setFromAxisAngle(up, Math.atan2(tangent.x, tangent.z));
      m.compose(position, q, one);
      this.dots.setMatrixAt(i, m);
      this.glow.setMatrixAt(i, m);
    });
    this.dots.count = this.glow.count = dots.length;
    this.dots.instanceMatrix.needsUpdate = this.glow.instanceMatrix.needsUpdate = true;
    this.distances = dots.map((d) => d.distance);
    this.total = end.distance;

    const angle = Math.atan2(direction.x, direction.z);
    this.arrow.position.set(end.position.x, 0, end.position.z);
    this.arrow.rotation.y = angle;
    this.arrowGlow.position.set(end.position.x, 0.006, end.position.z);
    this.group.visible = true;
    this.update(0);
  }

  // Walk the route (straight runs + rounded corners) and drop a dot every SPACING.
  sample(points, endGap) {
    // Keep only the corners
    const pts = points.filter((p, i) => {
      if (i === 0 || i === points.length - 1) return true;
      const a = p.clone().sub(points[i - 1]).normalize();
      const b = points[i + 1].clone().sub(p).normalize();
      return a.dot(b) < 0.999;
    });
    if (pts.length < 2) return null;

    // Dense polyline with quadratic-bezier corners
    const line = [pts[0].clone()];
    for (let i = 1; i < pts.length - 1; i++) {
      const corner = pts[i];
      const inDir = corner.clone().sub(pts[i - 1]).normalize();
      const outDir = pts[i + 1].clone().sub(corner).normalize();
      const a = corner.clone().addScaledVector(inDir, -CORNER_RADIUS);
      const b = corner.clone().addScaledVector(outDir, CORNER_RADIUS);
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        const p = a.clone().multiplyScalar((1 - t) ** 2).addScaledVector(corner, 2 * (1 - t) * t).addScaledVector(b, t * t);
        line.push(p);
      }
    }
    line.push(pts.at(-1).clone());

    // Arc-length along the polyline
    const lengths = [0];
    for (let i = 1; i < line.length; i++) lengths.push(lengths[i - 1] + line[i].distanceTo(line[i - 1]));
    const total = lengths.at(-1);
    const endDistance = total - endGap; // arrow origin; its tip lands endGap - ARROW_TIP before the end
    if (endDistance <= START_GAP) return null;

    const at = (d) => {
      let i = 1;
      while (i < lengths.length - 1 && lengths[i] < d) i++;
      const seg = lengths[i] - lengths[i - 1] || 1;
      const t = (d - lengths[i - 1]) / seg;
      const tangent = line[i].clone().sub(line[i - 1]).normalize();
      return { position: line[i - 1].clone().lerp(line[i], t), tangent, distance: d };
    };

    const dots = [];
    // Last dot sits a little behind the arrowhead
    for (let d = START_GAP; d <= endDistance - 0.2 && dots.length < MAX_DOTS; d += SPACING) dots.push(at(d));
    const end = at(endDistance);
    return { dots, end, direction: end.tangent };
  }

  // Soft pulses flow toward the arrow
  update(time) {
    if (!this.group.visible || !this.distances.length) return;
    const c = new THREE.Color();
    this.distances.forEach((d, i) => {
      const wave = 0.5 + 0.5 * Math.sin((d - time * 1.4) * 5);
      c.copy(TINT).lerp(CORE, wave ** 2);
      this.dots.setColorAt(i, c);
    });
    this.dots.instanceColor.needsUpdate = true;
    const pulse = 0.5 + 0.5 * Math.sin(time * 4);
    this.arrow.scale.setScalar(1 + pulse * 0.08);
  }
}
