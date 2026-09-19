// Pure game logic: no DOM, no three.js. Levels in, state sequences out.

export const COMMANDS = {
  up: { dx: 0, dy: -1, symbol: "↑", label: "arriba" },
  right: { dx: 1, dy: 0, symbol: "→", label: "derecha" },
  down: { dx: 0, dy: 1, symbol: "↓", label: "abajo" },
  left: { dx: -1, dy: 0, symbol: "←", label: "izquierda" },
  loop: { symbol: "∞", label: "repetir" },
};

export const LOOP_REPEATS = 20;

export function parseLevel(raw) {
  const rows = raw.grid.length;
  const columns = raw.grid[0].length;
  const walls = new Set(); // every blocked cell (stone blocks and trees)
  const trees = new Set(); // subset of walls, only changes how the cell is drawn
  let start = null;
  const batteries = []; // collect all of them to win
  raw.grid.forEach((line, y) => {
    [...line].forEach((ch, x) => {
      if (ch === "#" || ch === "T") walls.add(`${x},${y}`);
      if (ch === "T") trees.add(`${x},${y}`);
      if (ch === "S") start = { x, y };
      if (ch === "B") batteries.push({ x, y });
    });
  });
  if (!start || !batteries.length) throw new Error("Level needs an S (start) and at least one B (battery)");
  return { columns, rows, walls, trees, start, batteries, dir: raw.dir ?? "right", maxCommands: raw.maxCommands, loopAvailable: raw.loopAvailable };
}

export function isWall(level, x, y) {
  return level.walls.has(`${x},${y}`);
}

export function isInside(level, x, y) {
  return x >= 0 && x < level.columns && y >= 0 && y < level.rows;
}

// --- Program editing rules ---------------------------------------------------

export function canAdd(level, program, command) {
  if (program.length >= level.maxCommands) return false;
  if (program.includes("loop")) return false; // nothing goes after the loop
  if (command === "loop") return level.loopAvailable && program.length > 0;
  return command in COMMANDS;
}

export function removeAt(program, index) {
  const next = program.filter((_, i) => i !== index);
  return next[0] === "loop" ? [] : next;
}

// --- Interpreter -------------------------------------------------------------
// Runs the program and returns every step, so any renderer can replay it.
//
// steps: [{ commandIndex, command, heading, from, to, kind: "move" | "crash", bump, collect }]
// collect: the battery cell picked up on that step, if any.
// Commands are absolute directions, so the heading of each step is its command.
// outcome: "win" (all batteries collected) | "crash" | "empty" (ran out of commands first)

export function simulate(level, program) {
  const loopIndex = program.indexOf("loop");
  const movements = loopIndex === -1 ? program : program.slice(0, loopIndex);
  const steps = [];
  let pos = { ...level.start };
  const remaining = new Set(level.batteries.map((b) => `${b.x},${b.y}`));

  if (!movements.length) return { steps, outcome: "empty", route: [pos] };

  const maxSteps = loopIndex === -1 ? movements.length : movements.length * LOOP_REPEATS;
  for (let i = 0; i < maxSteps; i++) {
    const commandIndex = i % movements.length;
    const command = movements[commandIndex];
    const { dx, dy } = COMMANDS[command];
    const next = { x: pos.x + dx, y: pos.y + dy };
    const outside = !isInside(level, next.x, next.y);

    if (outside || isWall(level, next.x, next.y)) {
      steps.push({ commandIndex, command, heading: command, from: pos, to: pos, kind: "crash", outside, bump: outside ? pos : next });
      return { steps, outcome: "crash", route: routeOf(level, steps) };
    }

    const step = { commandIndex, command, heading: command, from: pos, to: next, kind: "move" };
    steps.push(step);
    pos = next;
    if (remaining.delete(`${pos.x},${pos.y}`)) {
      step.collect = pos;
      if (!remaining.size) return { steps, outcome: "win", route: routeOf(level, steps) };
    }
  }
  return { steps, outcome: "empty", route: routeOf(level, steps) };
}

function routeOf(level, steps) {
  return [level.start, ...steps.filter((s) => s.kind === "move").map((s) => s.to)];
}
