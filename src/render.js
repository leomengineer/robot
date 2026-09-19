// Render layer: builds the scene from a parsed level and animates states.
// Knows nothing about rules; main.js tells it what happened.
import * as THREE from "three";
import { COMMANDS, isWall } from "./logic.js";
import * as models from "./models.js";
import { PathLine } from "./path.js";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const smooth = (t) => t * t * (3 - 2 * t); // starts and ends at rest
const accel = (t) => t * t * (2 - t); // starts at rest, ends at cruise speed
const decel = (t) => 1 - accel(1 - t); // starts at cruise speed, ends at rest

// Robot faces +Z; heading angle maps +Z onto the command's direction.
const headingAngle = (dir) => Math.atan2(COMMANDS[dir].dx, COMMANDS[dir].dy);
const shortestDelta = (from, to) => {
  const d = (to - from) % (Math.PI * 2);
  return d > Math.PI ? d - Math.PI * 2 : d < -Math.PI ? d + Math.PI * 2 : d;
};

// Static objects skip per-frame matrix recomputation.
const freeze = (obj) => {
  obj.traverse((o) => {
    o.updateMatrix(); // every level of the hierarchy, not just the root
    o.matrixAutoUpdate = false;
  });
  obj.updateMatrixWorld(true);
};

const DRIVE_MS = 250; // one cell at cruise speed
const TURN_MS = 190; // quarter turn

export class BoxWorld {
  constructor(canvasHost, hole) {
    this.host = canvasHost;
    this.hole = hole; // DOM element marking the screen area the board should fill
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    // 1.5x is visually close to 2x on retina and renders ~45% fewer pixels
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    canvasHost.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x6aaecd, 16, 34);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);

    this.scene.add(new THREE.HemisphereLight(0xfff6e8, 0x6d8fb0, 1.5));
    const sun = new THREE.DirectionalLight(0xfff0dc, 2.2);
    sun.position.set(-4, 9, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    Object.assign(sun.shadow.camera, { left: -4.2, right: 4.2, top: 4.2, bottom: -4.2, near: 2, far: 20 });
    this.scene.add(sun);

    this.board = new THREE.Group();
    this.scene.add(this.board);
    this.path = new PathLine(this.board);
    this.buildScenery();

    this.tweens = [];
    this.clock = new THREE.Clock();
    this.nextBlink = 2;

    const observer = new ResizeObserver(() => this.resize());
    observer.observe(canvasHost);
    observer.observe(hole);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // --- scene building -------------------------------------------------------

  buildScenery() {
    this.floaters = [];
    const add = (obj, x, y, z, bob = 0.08) => {
      obj.position.set(x, y, z);
      obj.userData.float = { baseY: y, phase: Math.random() * Math.PI * 2, bob };
      this.scene.add(obj);
      this.floaters.push(obj);
    };
    add(models.createIsland(1.6, 1.4, { tree: true }), -5.6, 0.6, -2.6);
    add(models.createIsland(1.2, 1.2, { tree: true, h: 0.7 }), -6.4, -1.2, 1.6);
    add(models.createIsland(1.3, 1.1, { h: 0.6 }), -3.6, 1.6, -6.5);
    add(models.createIsland(1.4, 1.4, { tree: true }), 5.9, 0.2, -3.2);
    add(models.createIsland(1.8, 1.6, { tower: true, h: 1.2 }), 7.4, -0.4, 0.8);
    add(models.createIsland(1.1, 1.0, { tree: true, h: 0.6 }), 2.6, 2.2, -8);
    add(models.createIsland(0.9, 0.9, { h: 0.5 }), -1, 1.2, -9);

    this.clouds = [];
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, roughness: 1 });
    for (const [x, y, z, s] of [[-8, 2.5, -7, 1.4], [4, 3.2, -10, 1.8], [9, 1.5, -5, 1.1], [-2, 3.8, -12, 2]]) {
      const puff = new THREE.Group();
      puff.add(models.box(1.4 * s, 0.35 * s, 0.7 * s, cloudMat));
      puff.add(models.box(0.8 * s, 0.3 * s, 0.6 * s, cloudMat, { x: 0.3 * s, y: 0.25 * s }));
      const cloud = models.merge(puff, { cast: false, receive: false });
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
      this.clouds.push(cloud);
    }
  }

  build(level) {
    this.cancel();
    this.level = level;
    this.board.clear();
    this.tiles = new Map();
    this.walls = new Map();
    const W = level.columns;
    const D = level.rows;
    const P = models.PALETTE;

    // Island under the board: slab with gaps between tiles, raised rim, cliff and rocks.
    // Built as loose boxes, then baked into one mesh.
    const base = new THREE.Group();
    base.add(models.box(W + 0.1, 0.2, D + 0.1, models.mat(P.tileGap), { y: -0.16, cast: false }));
    const rim = models.mat(P.rim);
    base.add(models.box(W + 0.7, 0.18, 0.35, rim, { y: -0.04, z: -(D / 2 + 0.2) }));
    base.add(models.box(W + 0.7, 0.18, 0.35, rim, { y: -0.04, z: D / 2 + 0.2 }));
    base.add(models.box(0.35, 0.18, D + 0.05, rim, { x: -(W / 2 + 0.2), y: -0.04 }));
    base.add(models.box(0.35, 0.18, D + 0.05, rim, { x: W / 2 + 0.2, y: -0.04 }));
    base.add(models.box(W + 0.6, 0.5, D + 0.6, models.mat(0xd2c1a3), { y: -0.38 }));
    base.add(models.box(W + 0.3, 1.4, D + 0.3, models.mat(P.cliff), { y: -1.3 }));
    base.add(models.box(W * 0.7, 1.1, D * 0.7, models.mat(P.cliffDark), { x: 0.4, y: -2.4, z: -0.2 }));
    base.add(models.box(W * 0.35, 0.9, D * 0.4, models.mat(P.cliffDark), { x: -0.6, y: -3.3 }));
    base.add(models.box(0.9, 0.9, 0.9, models.mat(P.cliff), { x: -W / 2 - 0.35, y: -1.1, z: D / 2 - 0.6 }));
    base.add(models.box(0.8, 1.1, 0.8, models.mat(P.cliff), { x: W / 2 + 0.3, y: -1.0, z: -D / 2 + 0.8 }));
    this.board.add(models.merge(base));

    for (let y = 0; y < D; y++) {
      for (let x = 0; x < W; x++) {
        const wall = isWall(level, x, y);
        const tile = models.createFloorTile(wall ? "grass" : "floor");
        tile.position.copy(this.cellToWorld(x, y));
        freeze(tile);
        this.board.add(tile);
        this.tiles.set(`${x},${y}`, tile);
        if (wall) {
          const block = level.trees.has(`${x},${y}`) ? models.createTreeObstacle() : models.createWall();
          block.position.copy(this.cellToWorld(x, y));
          block.rotation.y = ((x * 7 + y * 3) % 4) * (Math.PI / 2); // vary look between blocks
          freeze(block);
          this.board.add(block);
          this.walls.set(`${x},${y}`, block);
        }
      }
    }

    this.tint(this.tiles.get(`${level.start.x},${level.start.y}`), P.start);
    // One battery per B cell, each on a glowing tile
    this.batteries = new Map(
      level.batteries.map(({ x, y }) => {
        const mesh = models.createBattery();
        mesh.position.copy(this.cellToWorld(x, y));
        this.board.add(mesh);
        const tile = this.tiles.get(`${x},${y}`);
        this.tint(tile, P.goal);
        return [`${x},${y}`, { mesh, tile, phase: x * 1.3 + y }];
      }),
    );

    this.robot = models.createRobot();
    this.board.add(this.robot);
    this.board.add(this.path.group); // board is cleared per level; the path is reused

    this.fitCamera();
    this.resetRobot();
  }

  cellToWorld(x, y) {
    return new THREE.Vector3(x - (this.level.columns - 1) / 2, 0, y - (this.level.rows - 1) / 2);
  }

  tint(object, color) {
    object?.userData.tint.forEach((m) => m.color.setHex(color));
  }

  resetRobot() {
    this.cancel();
    const { robot, level } = this;
    const parts = robot.userData;
    robot.position.copy(this.cellToWorld(level.start.x, level.start.y));
    robot.rotation.set(0, headingAngle(level.dir), 0);
    this.heading = level.dir;
    parts.chassis.rotation.set(0, 0, 0);
    parts.bodyMats[0].color.setHex(models.PALETTE.robotBody);
    parts.bodyMats[1].color.setHex(models.PALETTE.robotGrey);
    parts.eyeMat.emissiveIntensity = 1.2;
    parts.eyeMat.color.setHex(models.PALETTE.eye);
    parts.eyes.forEach((e) => e.scale.set(1, 1, 1));
    parts.tipMat.emissiveIntensity = 0.4;
    this.poweredOff = false;
    for (const { mesh, tile } of this.batteries.values()) {
      this.tint(tile, models.PALETTE.goal);
      mesh.visible = true;
      mesh.scale.set(1, 1, 1);
      mesh.userData.lift = 0;
    }
    this.clearBump();
  }

  showPath(route) {
    const last = route.at(-1);
    this.path.show(
      route.map(({ x, y }) => this.cellToWorld(x, y)),
      { endsOnTarget: this.batteries.has(`${last.x},${last.y}`) },
    );
  }

  hidePath() {
    this.path?.hide();
  }

  // --- robot animations (each returns a Promise) ----------------------------

  spinWheels(leftDist, rightDist) {
    const { wheels, wheelRadius } = this.robot.userData;
    wheels.left.forEach((w) => (w.rotation.x += leftDist / wheelRadius));
    wheels.right.forEach((w) => (w.rotation.x += rightDist / wheelRadius));
  }

  async turnTo(heading) {
    if (heading === this.heading) return;
    const { robot } = this;
    const { trackHalf } = robot.userData;
    const start = robot.rotation.y;
    const delta = shortestDelta(start, headingAngle(heading));
    this.heading = heading;
    let last = 0;
    await this.tween(TURN_MS * (Math.abs(delta) / (Math.PI / 2)) ** 0.7, (t) => {
      const k = smooth(t);
      robot.rotation.y = start + delta * k;
      const d = (k - last) * delta * trackHalf; // tank turn: sides roll opposite ways
      this.spinWheels(-d, d);
      last = k;
    });
  }

  // easeIn/easeOut: false when the robot keeps rolling from/into a neighbouring move
  async drive(from, to, { easeIn = true, easeOut = true } = {}) {
    const a = this.cellToWorld(from.x, from.y);
    const b = this.cellToWorld(to.x, to.y);
    const { robot } = this;
    const { chassis } = robot.userData;
    const curve = easeIn && easeOut ? smooth : easeIn ? accel : easeOut ? decel : (t) => t;
    const duration = DRIVE_MS * (easeIn && easeOut ? 1.25 : easeIn || easeOut ? 1.1 : 1);
    let last = 0;
    await this.tween(duration, (t) => {
      const k = curve(t);
      robot.position.lerpVectors(a, b, k);
      this.spinWheels(k - last, k - last);
      last = k;
      // Lean back when speeding up, forward when braking
      const lean = (easeIn ? -Math.sin(Math.PI * Math.min(t * 2, 1)) * (t < 0.5 ? 1 : 0) : 0) + (easeOut ? Math.sin(Math.PI * Math.max(t * 2 - 1, 0)) : 0);
      chassis.rotation.x = lean * 0.07;
    });
    chassis.rotation.x = 0;
  }

  async bump(step) {
    const { robot } = this;
    const { chassis } = robot.userData;
    const home = this.cellToWorld(step.from.x, step.from.y);
    const { dx, dy } = COMMANDS[step.command];
    const dir = new THREE.Vector3(dx, 0, dy);

    let last = 0;
    await this.tween(200, (t) => {
      const k = accel(t) * 0.3;
      robot.position.copy(home).addScaledVector(dir, k);
      this.spinWheels(k - last, k - last);
      last = k;
    });
    const target = step.outside ? this.tiles.get(`${step.from.x},${step.from.y}`) : this.walls.get(`${step.bump.x},${step.bump.y}`);
    this.flash(target);
    await this.tween(340, (t) => {
      const k = 0.3 * (1 - decel(t));
      robot.position.copy(home).addScaledVector(dir, k);
      this.spinWheels(k - last, k - last);
      last = k;
      chassis.rotation.x = -Math.sin(t * Math.PI * 5) * 0.12 * (1 - t);
    });
    chassis.rotation.x = 0;
  }

  async powerOff() {
    const parts = this.robot.userData;
    this.poweredOff = true;
    const fromBody = parts.bodyMats[0].color.clone();
    const off = new THREE.Color(models.PALETTE.robotOff);
    await this.tween(380, (t) => {
      const k = smooth(t);
      parts.bodyMats[0].color.lerpColors(fromBody, off, k * 0.6);
      parts.eyeMat.emissiveIntensity = 1.2 * (1 - k);
      parts.eyeMat.color.lerpColors(new THREE.Color(models.PALETTE.eye), new THREE.Color(0x3a4150), k);
      parts.eyes.forEach((e) => (e.scale.y = 1 - 0.7 * k));
      parts.tipMat.emissiveIntensity = 0.4 * (1 - k);
      parts.chassis.rotation.x = 0.16 * k; // slump forward
    });
  }

  // Battery on this cell rises and shrinks into the robot
  async pickUp(cell) {
    const entry = this.batteries.get(`${cell.x},${cell.y}`);
    if (!entry) return;
    const battery = entry.mesh;
    const tip = this.robot.userData.tipMat;
    await this.tween(300, (t) => {
      battery.userData.lift = smooth(t) * 0.6;
      battery.scale.setScalar(1 - smooth(t) * 0.95);
      tip.emissiveIntensity = 0.4 + Math.sin(Math.PI * t) * 1.6;
    });
    battery.visible = false;
    this.tint(entry.tile, models.PALETTE.tile); // collected: back to a plain tile
  }

  // Happy spin in place on its wheels, eyes squint
  async celebrate() {
    const { robot } = this;
    const parts = robot.userData;
    const start = robot.rotation.y;
    let last = 0;
    await this.tween(650, (t) => {
      const k = smooth(t);
      robot.rotation.y = start + k * Math.PI * 2;
      const d = (k - last) * Math.PI * 2 * parts.trackHalf;
      this.spinWheels(-d, d);
      last = k;
      parts.eyes.forEach((e) => (e.scale.y = 1 - 0.6 * Math.sin(Math.PI * t)));
      parts.tipMat.emissiveIntensity = 0.4 + Math.sin(t * Math.PI * 6) ** 2 * 1.5;
    });
    parts.tipMat.emissiveIntensity = 0.4;
  }

  flash(object) {
    this.clearBump();
    if (!object) return;
    this.bumped = object;
    this.tint(object, models.PALETTE.bump);
  }

  clearBump() {
    if (!this.bumped) return;
    const { tint, baseColors, baseColor } = this.bumped.userData;
    tint.forEach((m, i) => m.color.setHex(baseColors ? baseColors[i] : baseColor));
    // Start/battery tiles keep their highlight
    const start = this.tiles.get(`${this.level.start.x},${this.level.start.y}`);
    if (this.bumped === start) this.tint(start, models.PALETTE.start);
    for (const { tile } of this.batteries.values()) if (this.bumped === tile) this.tint(tile, models.PALETTE.goal);
    this.bumped = null;
  }

  // --- tween engine ---------------------------------------------------------

  tween(duration, update) {
    return new Promise((resolve) => {
      this.tweens.push({ start: performance.now(), duration: reducedMotion ? 1 : duration, update, resolve });
    });
  }

  // Drops running tweens and resolves their promises so awaiting code can bail out.
  cancel() {
    const pending = this.tweens;
    this.tweens = [];
    pending.forEach((tw) => tw.resolve());
  }

  frame() {
    if (this.paused) return;
    const now = performance.now();
    this.tweens = this.tweens.filter((tw) => {
      const t = Math.min(1, (now - tw.start) / tw.duration);
      tw.update(t);
      if (t >= 1) tw.resolve();
      return t < 1;
    });

    const time = this.clock.getElapsedTime();
    if (!reducedMotion) {
      for (const f of this.floaters) f.position.y = f.userData.float.baseY + Math.sin(time * 0.6 + f.userData.float.phase) * f.userData.float.bob;
      for (const c of this.clouds) c.position.x = ((c.position.x + 0.004 + 14) % 28) - 14;
    }
    for (const { mesh, tile, phase } of this.batteries?.values() ?? []) {
      if (mesh.visible) {
        mesh.position.y = 0.04 + Math.sin(time * 2.2 + phase) * 0.04 + (mesh.userData.lift || 0);
        mesh.rotation.y = time * 0.8 + phase;
      }
      const glow = tile.userData.tint[0];
      glow.emissive.setHex(models.PALETTE.goal);
      glow.emissiveIntensity = mesh.visible ? 0.25 + Math.sin(time * 3 + phase) * 0.12 : 0;
    }
    this.path?.update(time);
    if (this.robot && !this.poweredOff && !this.tweens.length) this.idleRobot(time);
    this.renderer.render(this.scene, this.camera);
  }

  idleRobot(time) {
    const parts = this.robot.userData;
    parts.tipMat.emissiveIntensity = 0.35 + Math.sin(time * 3) * 0.25;
    if (time > this.nextBlink) {
      const t = (time - this.nextBlink) / 0.16;
      parts.eyes.forEach((e) => (e.scale.y = t < 1 ? 1 - Math.sin(Math.PI * t) * 0.9 : 1));
      if (t >= 1) this.nextBlink = time + 2 + Math.random() * 3;
    }
  }

  // --- camera ---------------------------------------------------------------

  resize() {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.fitCamera();
  }

  // Fit the board inside the "hole" element (the screen area not covered by UI).
  fitCamera() {
    if (!this.level) return;
    const W = this.host.clientWidth;
    const H = this.host.clientHeight;
    const hostRect = this.host.getBoundingClientRect();
    const rect = this.hole.getBoundingClientRect();
    const hx = rect.left - hostRect.left + rect.width / 2;
    const hy = rect.top - hostRect.top + rect.height / 2;

    const cam = this.camera;
    cam.aspect = W / H;
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const elevation = THREE.MathUtils.degToRad(55);
    const boardW = this.level.columns + 2;
    const boardD = (this.level.rows + 1.2) * Math.sin(elevation) + 1.8 * Math.cos(elevation);
    const dist = Math.max(boardW / 2 / (tanV * (rect.width / H)), boardD / 2 / (tanV * (rect.height / H))) * 1.1;

    cam.position.set(0, Math.sin(elevation) * dist, Math.cos(elevation) * dist);
    this.scene.fog.near = dist + 3;
    this.scene.fog.far = dist + 20;
    cam.lookAt(0, 0, 0.1);
    // Shift the projection so the board centre lands on the hole centre
    cam.setViewOffset(W, H, W / 2 - hx, H / 2 - hy, W, H);
    cam.updateProjectionMatrix();
  }
}
