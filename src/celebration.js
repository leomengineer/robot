// Small 3D scene for the win popup: the robot drives, hops and spins under box confetti.
// Runs its own render loop only while the popup is open.
import * as THREE from "three";
import * as models from "./models.js";

const CONFETTI_COLORS = [0x27a6b8, 0x8b62d8, 0xef7b3b, 0xe25a7c, 0xf3b733, 0x69bd6b];
const smooth = (t) => t * t * (3 - 2 * t);

export class Celebration {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.camera.position.set(0, 1.25, 2.9);
    this.camera.lookAt(0, 0.45, 0);

    this.scene.add(new THREE.HemisphereLight(0xfff6e8, 0x8a7fa0, 1.6));
    const sun = new THREE.DirectionalLight(0xfff0dc, 2);
    sun.position.set(-2, 5, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(512, 512);
    Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2 });
    this.scene.add(sun);

    // Stage: a floor slab on a dirt block, like a tiny board
    const stage = new THREE.Group();
    stage.add(models.box(2.2, 0.16, 1.2, models.mat(models.PALETTE.tile), { y: -0.08 }));
    stage.add(models.box(2.3, 0.3, 1.3, models.mat(models.PALETTE.rim), { y: -0.3 }));
    stage.add(models.box(2.0, 0.5, 1.0, models.mat(models.PALETTE.cliff), { y: -0.7 }));
    const stageMesh = models.merge(stage, { cast: false });
    this.scene.add(stageMesh);

    this.robot = models.createRobot();
    this.scene.add(this.robot);

    this.confetti = Array.from({ length: 36 }, (_, i) => {
      const piece = models.box(0.07, 0.07, 0.07, models.mat(CONFETTI_COLORS[i % CONFETTI_COLORS.length], { roughness: 0.5 }), { cast: false, receive: false });
      this.scene.add(piece);
      this.respawn(piece, true);
      return piece;
    });
  }

  respawn(piece, anywhere = false) {
    piece.position.set((Math.random() - 0.5) * 3.4, anywhere ? Math.random() * 2.4 : 2.4, (Math.random() - 0.5) * 1.6);
    piece.userData.speed = 0.5 + Math.random() * 0.7;
    piece.userData.spin = (Math.random() - 0.5) * 8;
  }

  start() {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.start0 = performance.now();
    this.last = this.start0;
    this.lastX = 0;
    this.renderer.setAnimationLoop(() => this.frame());
  }

  stop() {
    this.renderer.setAnimationLoop(null);
  }

  frame() {
    const now = performance.now();
    const t = (now - this.start0) / 1000;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const robot = this.robot;
    const parts = robot.userData;

    // Drive side to side, turned a little toward the travel direction
    const x = Math.sin(t * 1.5) * 0.55;
    const vx = x - this.lastX;
    this.lastX = x;
    robot.position.x = x;
    const travelYaw = Math.cos(t * 1.5) * 0.55;

    // Two small hops, then a big jump with a full spin (2.4s loop)
    const cycle = t % 2.4;
    let hop;
    let spin = 0;
    if (cycle < 1.6) {
      hop = Math.sin(Math.PI * ((cycle % 0.8) / 0.8)) * 0.22;
    } else {
      const p = (cycle - 1.6) / 0.8;
      hop = Math.sin(Math.PI * p) * 0.6;
      spin = smooth(p) * Math.PI * 2;
    }
    robot.position.y = hop;
    robot.rotation.y = travelYaw + spin;
    const squash = hop < 0.04 ? 0.12 * (1 - hop / 0.04) : 0;
    robot.scale.set(1 + squash * 0.6, 1 - squash, 1 + squash * 0.6);

    // Wheels roll with sideways travel; spin faster in the air
    const roll = vx / parts.wheelRadius + (hop > 0.05 ? dt * 18 : 0);
    [...parts.wheels.left, ...parts.wheels.right].forEach((w) => (w.rotation.x += roll));

    // Happy squinting eyes, blinking antenna
    parts.eyes.forEach((e) => (e.scale.y = 0.45 + Math.abs(Math.sin(t * 3)) * 0.2));
    parts.tipMat.emissiveIntensity = 0.4 + (Math.sin(t * 10) > 0 ? 1.4 : 0);
    parts.chassis.rotation.z = Math.sin(t * 6) * 0.06;

    for (const piece of this.confetti) {
      piece.position.y -= piece.userData.speed * dt;
      piece.rotation.x += piece.userData.spin * dt;
      piece.rotation.z += piece.userData.spin * 0.7 * dt;
      if (piece.position.y < -0.2) this.respawn(piece);
    }

    this.renderer.render(this.scene, this.camera);
  }
}
