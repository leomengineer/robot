// Start screen scene: the robot patrols a little floating island, turning on its
// wheels at each corner and hopping at the end of every lap. Runs only while shown.
import * as THREE from "three";
import * as models from "./models.js";

const smooth = (t) => t * t * (3 - 2 * t);
const angleOf = (dx, dz) => Math.atan2(dx, dz); // robot faces +Z
const shortest = (from, to) => {
  const d = (to - from) % (Math.PI * 2);
  return d > Math.PI ? d - Math.PI * 2 : d < -Math.PI ? d + Math.PI * 2 : d;
};

// Square patrol around the centre of a 5x5 island
const CORNERS = [
  [-1.5, 1.5],
  [1.5, 1.5],
  [1.5, -1.5],
  [-1.5, -1.5],
];
const DRIVE_S = 1.3;
const TURN_S = 0.4;
const HOP_S = 0.9;

function buildTimeline() {
  const steps = [];
  CORNERS.forEach(([x, z], i) => {
    const [nx, nz] = CORNERS[(i + 1) % CORNERS.length];
    const heading = angleOf(nx - x, nz - z);
    steps.push({ type: "turn", heading, duration: TURN_S });
    steps.push({ type: "drive", from: [x, z], to: [nx, nz], duration: DRIVE_S });
  });
  steps.push({ type: "hop", duration: HOP_S });
  let t = 0;
  for (const step of steps) {
    step.start = t;
    t += step.duration;
  }
  return { steps, length: t };
}

export class Intro {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);

    this.scene.add(new THREE.HemisphereLight(0xfff6e8, 0x6d8fb0, 1.5));
    const sun = new THREE.DirectionalLight(0xfff0dc, 2.2);
    sun.position.set(-4, 9, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.normalBias = 0.02;
    Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 2, far: 20 });
    this.scene.add(sun);

    this.buildIsland();
    this.robot = models.createRobot();
    this.robot.scale.setScalar(1.35); // the star of the screen
    this.robotScale = 1.35;
    this.scene.add(this.robot);
    this.timeline = buildTimeline();

    // A few faded islands and clouds behind, like the game's backdrop
    this.floaters = [];
    for (const [x, y, z, w, tree] of [[-5.5, -1, -4, 1.4, true], [5.2, -0.4, -5, 1.2, true], [-4.6, -2.8, 1.5, 1, false], [4.8, -2.2, 1, 1.1, true]]) {
      const island = models.createIsland(w, w, { tree, h: 0.7 });
      island.position.set(x, y, z);
      island.userData.baseY = y;
      island.userData.phase = x;
      this.scene.add(island);
      this.floaters.push(island);
    }
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.35, transparent: true, opacity: 0.5, depthWrite: false });
    this.clouds = [[-7, -3, -8, 1.8], [2, -4.5, -9, 2.2], [7, -1.5, -7, 1.5], [-2, -5.5, -3, 1.4], [6, -5, 2, 1.3]].map(([x, y, z, s]) => {
      const puff = new THREE.Group();
      puff.add(models.box(1.4 * s, 0.35 * s, 0.7 * s, cloudMat));
      puff.add(models.box(0.8 * s, 0.3 * s, 0.6 * s, cloudMat, { x: 0.3 * s, y: 0.25 * s }));
      const cloud = models.merge(puff, { cast: false, receive: false });
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
      return cloud;
    });
  }

  buildIsland() {
    const P = models.PALETTE;
    const base = new THREE.Group();
    base.add(models.box(5.1, 0.2, 5.1, models.mat(P.tileGap), { y: -0.16, cast: false }));
    base.add(models.box(5.6, 0.5, 5.6, models.mat(0xd2c1a3), { y: -0.38 }));
    base.add(models.box(5.3, 1.3, 5.3, models.mat(P.cliff), { y: -1.25 }));
    base.add(models.box(3.4, 1, 3.4, models.mat(P.cliffDark), { x: 0.3, y: -2.3 }));
    base.add(models.box(1.6, 0.8, 1.8, models.mat(P.cliffDark), { x: -0.4, y: -3.1 }));
    this.scene.add(models.merge(base));

    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 2; z++) {
        const edge = Math.abs(x) === 2 || Math.abs(z) === 2;
        const corner = Math.abs(x) === 2 && Math.abs(z) === 2;
        const tile = models.createFloorTile(corner ? "grass" : "floor");
        tile.position.set(x, 0, z);
        this.scene.add(tile);
        if (corner && z < 0) { // trees only at the back, so they never hide the robot
          const tree = models.createTreeObstacle();
          tree.position.set(x, 0, z);
          tree.rotation.y = (x + z) * 0.7;
          this.scene.add(tree);
        } else if (!edge && x === 0 && z === 0) {
          this.battery = models.createBattery();
          this.scene.add(this.battery);
        }
      }
    }
  }

  start() {
    this.resize();
    // Watching the canvas also covers window resizes, and fires once with the
    // real size when the layout finally gives the canvas its measurements.
    this.observer ??= new ResizeObserver(() => this.resize());
    this.observer.observe(this.canvas);
    this.t0 = performance.now();
    this.last = { pos: new THREE.Vector3(), yaw: 0, first: true };
    this.renderer.setAnimationLoop(() => this.frame());
  }

  stop() {
    this.renderer.setAnimationLoop(null);
    this.observer?.disconnect();
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    // The canvas can still measure 0 while the page lays out; the camera has to
    // end up valid anyway, or the first frame throws and the loop never draws.
    if (w && h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
    }
    // Keep the whole island in frame on narrow (portrait) screens too
    const dist = 11.5 * Math.max(1, 1.1 / this.camera.aspect);
    this.baseCamera = new THREE.Vector3(0, 0.62, 0.78).normalize().multiplyScalar(dist);
    this.camera.updateProjectionMatrix();
  }

  // Pose of the robot at time t along the looping timeline
  pose(t) {
    const { steps, length } = this.timeline;
    const local = t % length;
    const step = steps.find((s) => local < s.start + s.duration) ?? steps.at(-1);
    const k = Math.min(1, (local - step.start) / step.duration);
    const pose = { x: 0, z: 0, yaw: 0, y: 0, squash: 0 };

    // Position/heading carried over from the previous steps
    const [lx, lz] = CORNERS.at(-1);
    let cur = { x: CORNERS[0][0], z: CORNERS[0][1], yaw: angleOf(CORNERS[0][0] - lx, CORNERS[0][1] - lz) };
    for (const s of steps) {
      if (s === step) break;
      if (s.type === "drive") [cur.x, cur.z] = s.to;
      if (s.type === "turn") cur.yaw = cur.yaw + shortest(cur.yaw, s.heading);
    }
    Object.assign(pose, cur);

    if (step.type === "turn") pose.yaw = cur.yaw + shortest(cur.yaw, step.heading) * smooth(k);
    if (step.type === "drive") {
      const e = smooth(k);
      pose.x = step.from[0] + (step.to[0] - step.from[0]) * e;
      pose.z = step.from[1] + (step.to[1] - step.from[1]) * e;
    }
    if (step.type === "hop") {
      pose.y = Math.sin(Math.PI * k) * 0.55;
      pose.yaw = cur.yaw + smooth(k) * Math.PI * 2;
      pose.squash = k > 0.85 ? Math.sin(Math.PI * (k - 0.85) / 0.15) * 0.12 : 0;
    }
    return pose;
  }

  frame() {
    const t = (performance.now() - this.t0) / 1000;
    const { robot } = this;
    const parts = robot.userData;
    const p = this.pose(t);

    robot.position.set(p.x, p.y, p.z);
    robot.rotation.y = p.yaw;
    const s = this.robotScale;
    robot.scale.set(s * (1 + p.squash * 0.6), s * (1 - p.squash), s * (1 + p.squash * 0.6));

    // Wheels: roll with forward travel, counter-rotate when turning in place
    const pos = robot.position.clone().setY(0);
    if (!this.last.first) {
      const forward = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
      const travel = pos.clone().sub(this.last.pos).dot(forward);
      const turn = shortest(this.last.yaw, p.yaw) * parts.trackHalf;
      const left = (travel - turn) / (parts.wheelRadius * this.robotScale);
      const right = (travel + turn) / (parts.wheelRadius * this.robotScale);
      parts.wheels.left.forEach((w) => (w.rotation.x += left));
      parts.wheels.right.forEach((w) => (w.rotation.x += right));
    }
    this.last = { pos, yaw: p.yaw, first: false };

    // Blinks and a pulsing antenna
    const blink = t % 3.2 < 0.14 ? 0.15 : 1;
    parts.eyes.forEach((e) => (e.scale.y = blink));
    parts.tipMat.emissiveIntensity = 0.4 + Math.max(0, Math.sin(t * 4)) * 0.9;

    if (this.battery) {
      this.battery.position.y = 0.05 + Math.sin(t * 2.2) * 0.05;
      this.battery.rotation.y = t * 0.8;
    }
    for (const f of this.floaters) f.position.y = f.userData.baseY + Math.sin(t * 0.6 + f.userData.phase) * 0.08;
    for (const c of this.clouds) c.position.x = ((c.position.x + 0.004 + 12) % 24) - 12;

    // Slow, gentle camera sway around the island
    const sway = Math.sin(t * 0.15) * 0.35;
    this.camera.position.copy(this.baseCamera).applyAxisAngle(new THREE.Vector3(0, 1, 0), sway);
    this.camera.lookAt(0, -0.85, 0.3); // island sits high, leaving room for the play button below

    this.renderer.render(this.scene, this.camera);
  }
}
