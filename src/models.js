// Placeholder models: everything is built from boxes.
// Swap these factories for GLTF loads later. The renderer only relies on:
//   - the returned Object3D, with its origin on the floor surface (y = 0)
//   - optional userData hooks (tint, robot parts) documented per factory
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const PALETTE = {
  tile: 0xefe4d0,
  tileGap: 0xcbb898,
  rim: 0xe6d8bf,
  cliff: 0x9b6a50,
  cliffDark: 0x7d5243,
  grass: 0x6aa55c,
  grassDark: 0x4f8a4a,
  stone: 0x6f6776,
  stoneLight: 0x857d8b,
  start: 0x57c9cf,
  goal: 0xf6c343,
  trunk: 0x7a5238,
  leaves: 0x4f9a5e,
  leavesLight: 0x68b06a,
  robotBody: 0xf3eee6,
  robotGrey: 0xc9ccd3,
  robotOff: 0x9a9ca3,
  visor: 0x283042,
  eye: 0x6ff3ff,
  tire: 0x33303a,
  hub: 0xf07b32,
  antennaTip: 0xf06a3a,
  battery: 0xf39a2b,
  batteryCap: 0x4a4550,
  bolt: 0xfff1b8,
  bump: 0xef5b52,
};

const materials = new Map();
// Shared materials by default; pass own=true when the object needs to change color on its own.
export function mat(color, { own = false, emissive = 0x000000, emissiveIntensity = 1, roughness = 0.85 } = {}) {
  const make = () => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, emissive, emissiveIntensity });
  if (own) return make();
  const key = `${color}-${emissive}-${emissiveIntensity}-${roughness}`;
  if (!materials.has(key)) materials.set(key, make());
  return materials.get(key);
}

const geometries = new Map();
export function box(w, h, d, material, { x = 0, y = 0, z = 0, cast = true, receive = true } = {}) {
  const key = `${w}|${h}|${d}`;
  if (!geometries.has(key)) geometries.set(key, new THREE.BoxGeometry(w, h, d));
  const mesh = new THREE.Mesh(geometries.get(key), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

// Bakes a group of static boxes into one mesh (one draw call per material).
export function merge(root, { cast = true, receive = true } = {}) {
  root.updateMatrixWorld(true);
  const byMaterial = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (!byMaterial.has(o.material)) byMaterial.set(o.material, []);
    byMaterial.get(o.material).push(o.geometry.clone().applyMatrix4(o.matrixWorld));
  });
  const materialsList = [...byMaterial.keys()];
  const parts = materialsList.map((m) => mergeGeometries(byMaterial.get(m)));
  const mesh = new THREE.Mesh(mergeGeometries(parts, true), materialsList);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

// --- board pieces ------------------------------------------------------------

// userData.tint: material the renderer may recolor (start / goal / bump highlights)
export function createFloorTile(kind = "floor") {
  const color = kind === "grass" ? PALETTE.grass : PALETTE.tile;
  const top = mat(color, { own: true });
  const group = new THREE.Group();
  group.add(box(0.9, 0.14, 0.9, top, { y: -0.07, cast: false }));
  group.userData.tint = [top];
  group.userData.baseColor = color;
  return group;
}

// A stack of stone cubes, like the reference's rock blocks.
export function createWall() {
  const stone = mat(PALETTE.stone, { own: true });
  const light = mat(PALETTE.stoneLight, { own: true });
  const group = new THREE.Group();
  const s = 0.38;
  const h = 0.27;
  for (let layer = 0; layer < 2; layer++) {
    for (const [ix, iz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const m = (ix + iz + layer) % 4 === 0 ? light : stone;
      group.add(box(s, h, s, m, { x: ix * (s / 2 + 0.01), y: h / 2 + layer * (h + 0.02), z: iz * (s / 2 + 0.01) }));
    }
  }
  const wall = merge(group);
  wall.userData.tint = [stone, light];
  wall.userData.baseColors = [PALETTE.stone, PALETTE.stoneLight];
  return wall;
}

// Tree standing on a board cell. Own leaf materials so a crash can flash it red.
export function createTreeObstacle() {
  const leaves = mat(PALETTE.leaves, { own: true });
  const leavesLight = mat(PALETTE.leavesLight, { own: true });
  const group = new THREE.Group();
  group.add(box(0.16, 0.4, 0.16, mat(PALETTE.trunk), { y: 0.2 }));
  group.add(box(0.62, 0.42, 0.62, leaves, { y: 0.58 }));
  group.add(box(0.4, 0.28, 0.4, leavesLight, { x: 0.08, y: 0.9, z: 0.06 }));
  group.add(box(0.26, 0.22, 0.26, leaves, { x: -0.22, y: 0.46, z: 0.2 }));
  const tree = merge(group);
  tree.userData.tint = [leaves, leavesLight];
  tree.userData.baseColors = [PALETTE.leaves, PALETTE.leavesLight];
  return tree;
}

export function createBattery() {
  const group = new THREE.Group();
  const body = mat(PALETTE.battery, { emissive: 0x7a3a00, emissiveIntensity: 0.25, roughness: 0.6 });
  group.add(box(0.3, 0.42, 0.3, body, { y: 0.21 }));
  group.add(box(0.32, 0.05, 0.32, mat(0xd9801d), { y: 0.06 }));
  group.add(box(0.32, 0.05, 0.32, mat(0xd9801d), { y: 0.37 }));
  group.add(box(0.12, 0.07, 0.12, mat(PALETTE.batteryCap), { y: 0.46 }));
  // Lightning bolt out of two slanted boxes on the front and back
  const bolt = mat(PALETTE.bolt, { emissive: 0xffd35c, emissiveIntensity: 0.6 });
  for (const side of [1, -1]) {
    const a = box(0.05, 0.14, 0.02, bolt, { x: 0.02, y: 0.26, z: side * 0.155, cast: false });
    a.rotation.z = -0.5;
    const b = box(0.05, 0.14, 0.02, bolt, { x: -0.02, y: 0.16, z: side * 0.155, cast: false });
    b.rotation.z = -0.5;
    group.add(a, b);
  }
  return merge(group);
}

// Robot facing +Z. userData: chassis (tilts), wheels {left, right}, eyes, antennaTip, bodyMats, wheelRadius, trackHalf
export function createRobot() {
  const robot = new THREE.Group();
  const chassis = new THREE.Group();
  chassis.position.y = 0.12;
  robot.add(chassis);

  const body = mat(PALETTE.robotBody, { own: true, roughness: 0.55 });
  const grey = mat(PALETTE.robotGrey, { own: true, roughness: 0.6 });
  chassis.add(box(0.5, 0.36, 0.44, body, { y: 0.24 }));
  chassis.add(box(0.44, 0.06, 0.38, grey, { y: 0.03 }));
  chassis.add(box(0.46, 0.04, 0.4, body, { y: 0.44 }));

  // Face: dark visor with two glowing eyes
  chassis.add(box(0.38, 0.2, 0.03, mat(PALETTE.visor, { roughness: 0.3 }), { y: 0.26, z: 0.225, cast: false }));
  const eyeMat = mat(PALETTE.eye, { own: true, emissive: PALETTE.eye, emissiveIntensity: 1.2 });
  const eyes = [-0.08, 0.08].map((x) => box(0.07, 0.1, 0.02, eyeMat, { x, y: 0.26, z: 0.245, cast: false }));
  chassis.add(...eyes);

  // Side "ears"
  chassis.add(box(0.05, 0.14, 0.14, grey, { x: 0.275, y: 0.26 }), box(0.05, 0.14, 0.14, grey, { x: -0.275, y: 0.26 }));

  // Antenna
  chassis.add(box(0.03, 0.16, 0.03, grey, { y: 0.54 }));
  const tipMat = mat(PALETTE.antennaTip, { own: true, emissive: PALETTE.antennaTip, emissiveIntensity: 0.4, roughness: 0.4 });
  const antennaTip = box(0.09, 0.09, 0.09, tipMat, { y: 0.66 });
  chassis.add(antennaTip);

  // Wheels: tire box + orange hub, spinning around the X axle
  const wheelRadius = 0.1;
  const trackHalf = 0.28;
  const wheels = { left: [], right: [] };
  for (const side of [-1, 1]) {
    for (const z of [-0.14, 0.14]) {
      const wheel = new THREE.Group();
      wheel.position.set(side * trackHalf, wheelRadius, z);
      wheel.add(box(0.08, 0.2, 0.2, mat(PALETTE.tire, { roughness: 0.95 })));
      wheel.add(box(0.09, 0.09, 0.09, mat(PALETTE.hub), { x: side * 0.005 }));
      robot.add(wheel);
      (side > 0 ? wheels.left : wheels.right).push(wheel); // +X is the robot's left when facing +Z
    }
  }

  Object.assign(robot.userData, { chassis, wheels, eyes, antennaTip, eyeMat, tipMat, bodyMats: [body, grey], wheelRadius, trackHalf });
  return robot;
}

// --- scenery -----------------------------------------------------------------

export function createTree(scale = 1) {
  const group = new THREE.Group();
  group.add(box(0.14, 0.5, 0.14, mat(PALETTE.trunk), { y: 0.25 }));
  group.add(box(0.6, 0.5, 0.6, mat(PALETTE.leaves), { y: 0.7 }));
  group.add(box(0.36, 0.3, 0.36, mat(PALETTE.leavesLight), { x: 0.18, y: 0.98, z: 0.1 }));
  group.add(box(0.3, 0.26, 0.3, mat(PALETTE.leaves), { x: -0.24, y: 0.6, z: -0.18 }));
  group.scale.setScalar(scale);
  return group;
}

// Floating chunk of land: grass top, dirt body, tapering rocks underneath.
export function createIsland(w, d, { h = 0.9, tree = false, tower = false } = {}) {
  const group = new THREE.Group();
  group.add(box(w, 0.18, d, mat(PALETTE.grass), { y: -0.09 }));
  group.add(box(w * 0.96, h, d * 0.96, mat(PALETTE.cliff), { y: -0.18 - h / 2 }));
  group.add(box(w * 0.6, h * 0.7, d * 0.65, mat(PALETTE.cliffDark), { x: w * 0.08, y: -0.18 - h - h * 0.35, z: -d * 0.05 }));
  group.add(box(w * 0.3, h * 0.5, d * 0.3, mat(PALETTE.cliffDark), { x: -w * 0.1, y: -0.18 - h * 1.7 - h * 0.25 }));
  if (tree) {
    const t = createTree(Math.min(w, d) * 0.9);
    group.add(t);
  }
  if (tower) {
    group.add(box(w * 0.55, 1.1, d * 0.55, mat(0xe8d6b8), { y: 0.55 }));
    group.add(box(w * 0.66, 0.24, d * 0.66, mat(0xd8644c), { y: 1.22 }));
    group.add(box(w * 0.18, 0.34, 0.02, mat(0x8a5a44), { y: 0.17, z: d * 0.28 }));
  }
  return merge(group, { cast: false, receive: false });
}
