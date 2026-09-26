// UI layer: plain HTML controls on top of the 3D canvas.
import "./styles.css";
import data from "./levels.json";
import { COMMANDS, canAdd, parseLevel, removeAt, simulate } from "./logic.js";
import { BoxWorld } from "./render.js";
import { PALETTE } from "./models.js";
import { Intro } from "./intro.js";
import { Celebration } from "./celebration.js";

const LEVELS = data.levels.map(parseLevel);

// The console is painted with the 3D robot's own colours, so both always match
for (const [name, key] of Object.entries({ body: "robotBody", grey: "robotGrey", visor: "visor", eye: "eye" })) {
  document.documentElement.style.setProperty(`--robot-${name}`, `#${PALETTE[key].toString(16).padStart(6, "0")}`);
}
const PALETTE_ORDER = ["up", "left", "right", "down", "loop"];

const ICONS = {
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M12 3.5 20.5 12h-5.2v8.5H8.7V12H3.5z"/></svg>',
  loop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="line" d="M7.2 8C5 8 3.4 9.8 3.4 12S5 16 7.2 16c3.7 0 5.9-8 9.6-8 2.2 0 3.8 1.8 3.8 4s-1.6 4-3.8 4c-3.7 0-5.9-8-9.6-8z"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M8 5.5v13l10.5-6.5z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect class="fill" x="6.5" y="6.5" width="11" height="11" rx="2"/></svg>',
};

const state = {
  level: 0,
  program: [],
  running: false,
  poweredOff: false,
  execution: 0,
  completed: new Set(),
  slow: false,
};
try {
  state.slow = localStorage.getItem("robot.slow") === "1";
} catch {}

const ui = {
  stage: document.querySelector("#stage"),
  hole: document.querySelector("#hole"),
  console: document.querySelector("#console"),
  celebration: document.querySelector("#celebration"),
  levels: document.querySelector("#levels"),
  palette: document.querySelector("#palette"),
  program: document.querySelector("#program"),
  run: document.querySelector("#run"),
  reset: document.querySelector("#reset"),
  speed: document.querySelector("#speed"),
  success: document.querySelector("#success"),
  next: document.querySelector("#next"),
  status: document.querySelector("#status"),
  intro: document.querySelector("#intro"),
  start: document.querySelector("#start"),
};

// The board is framed in the space above the console and left of the level column
function syncHole() {
  const top = ui.console.getBoundingClientRect().top;
  ui.hole.style.bottom = `${window.innerHeight - top + 12}px`;
  // Keep the level column clear of the console (it can get tall with many levels)
  ui.levels.style.maxHeight = `${Math.max(120, top - 28)}px`;
}
new ResizeObserver(syncHole).observe(ui.console);
window.addEventListener("resize", syncHole);
syncHole();

const world = new BoxWorld(ui.stage, ui.hole);
const celebration = new Celebration(ui.celebration);
if (import.meta.env.DEV) window.__world = world; // handy for poking at animations from the console
const STEP_LIGHT_MS = 160; // instruction glows before the robot acts on it
const STEP_PAUSE_MS = 200; // robot rests on each cell before the next instruction
// Step-by-step mode: moves play slower and the robot rests longer, so each instruction reads on its own
const SLOW = { timeScale: 2, lightMs: 550, pauseMs: 650 };
const pace = () => (state.slow ? SLOW : { timeScale: 1, lightMs: STEP_LIGHT_MS, pauseMs: STEP_PAUSE_MS });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const currentLevel = () => LEVELS[state.level];

// --- HTML parts --------------------------------------------------------------

function tileContent(command) {
  return command === "loop" ? ICONS.loop : ICONS.arrow;
}

function buildPalette() {
  ui.palette.replaceChildren(
    ...PALETTE_ORDER.map((command) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `cmd cmd-${command}`;
      button.dataset.command = command;
      button.innerHTML = tileContent(command);
      button.setAttribute("aria-label", `Agregar ${COMMANDS[command].label}`);
      makeDraggable(button, command);
      return button;
    }),
  );
}

function renderLevelButtons() {
  ui.levels.replaceChildren(
    ...LEVELS.map((_, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "level";
      button.textContent = index + 1;
      button.setAttribute("aria-label", `Nivel ${index + 1}`);
      button.classList.toggle("active", index === state.level);
      button.classList.toggle("done", state.completed.has(index));
      button.addEventListener("click", () => loadLevel(index));
      return button;
    }),
  );
}

function renderProgram(activeIndex = -1, crashed = false) {
  ui.program.replaceChildren();
  state.program.forEach((command, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `cmd step cmd-${command}`;
    button.innerHTML = tileContent(command);
    button.setAttribute("aria-label", `Quitar ${COMMANDS[command].label}`);
    button.classList.toggle("active", index === activeIndex);
    button.classList.toggle("crashed", crashed && index === activeIndex);
    button.addEventListener("click", () => {
      if (state.running) return;
      state.program = removeAt(state.program, index);
      resetRobot();
    });
    ui.program.appendChild(button);
  });
  for (let i = state.program.length; i < currentLevel().maxCommands; i++) {
    const slot = document.createElement("span");
    slot.className = "slot";
    slot.setAttribute("aria-hidden", "true");
    ui.program.appendChild(slot);
  }
  updatePaletteAvailability();
}

// Light the running instruction in place (no re-render, so the glow can animate)
function highlightStep(activeIndex) {
  ui.program.querySelectorAll(".step").forEach((button, index) => {
    button.classList.toggle("active", index === activeIndex);
    button.classList.toggle("looping", activeIndex !== -1 && state.program[index] === "loop");
  });
}

function updatePaletteAvailability() {
  ui.palette.querySelectorAll(".cmd").forEach((button) => {
    const command = button.dataset.command;
    button.hidden = command === "loop" && !currentLevel().loopAvailable;
    button.classList.toggle("unavailable", state.running || !canAdd(currentLevel(), state.program, command));
  });
}

function renderPath() {
  if (state.running) return world.hidePath();
  world.showPath(simulate(currentLevel(), state.program).route);
}

function setRunButton(running) {
  ui.run.classList.toggle("running", running);
  ui.program.classList.toggle("running", running);
  // Out of battery: the program has to change (or be reset) before running again
  ui.run.disabled = state.poweredOff && !running;
  ui.run.innerHTML = running ? ICONS.stop : ICONS.play;
  ui.run.setAttribute("aria-label", running ? "Detener" : "Ejecutar instrucciones");
}

function setSlow(slow) {
  state.slow = slow;
  ui.speed.setAttribute("aria-pressed", String(slow));
  if (state.running) world.timeScale = pace().timeScale; // takes effect from the next move
  try {
    localStorage.setItem("robot.slow", slow ? "1" : "0");
  } catch {}
}

function showSuccess(show) {
  if (!show && ui.success.contains(document.activeElement)) ui.run.focus();
  ui.success.classList.toggle("show", show);
  ui.success.setAttribute("aria-hidden", String(!show));
  ui.success.inert = !show;
  // the popup (or the start screen) covers the board; no need to keep rendering it
  world.paused = show || !ui.intro.classList.contains("hide");
  if (show) celebration.start();
  else celebration.stop();
}

// --- drag and drop (pointer events, so it works with touch too) -------------

let suppressClick = false;

function makeDraggable(button, command) {
  let start = null;
  let ghost = null;

  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || state.running) return;
    start = { x: event.clientX, y: event.clientY };
    try { button.setPointerCapture(event.pointerId); } catch {}
  });

  button.addEventListener("pointermove", (event) => {
    if (!start) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (!ghost && moved > 8) {
      ghost = button.cloneNode(true);
      ghost.classList.add("ghost");
      const r = button.getBoundingClientRect();
      ghost.style.width = `${r.width}px`;
      ghost.style.height = `${r.height}px`;
      document.body.appendChild(ghost);
      document.body.classList.add("dragging");
    }
    if (ghost) {
      ghost.style.left = `${event.clientX}px`;
      ghost.style.top = `${event.clientY}px`;
      ui.program.classList.toggle("drop-over", overProgram(event) && canAdd(currentLevel(), state.program, command));
    }
  });

  const finish = (event) => {
    if (ghost) {
      // Swallow the click that follows this pointerup (touch often sends none, so clear it after)
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 0);
      if (event.type === "pointerup" && overProgram(event)) addCommand(command);
      ghost.remove();
      ghost = null;
      document.body.classList.remove("dragging");
      ui.program.classList.remove("drop-over");
    }
    start = null;
  };
  button.addEventListener("pointerup", finish);
  button.addEventListener("pointercancel", finish);

  button.addEventListener("click", () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    addCommand(command);
  });
}

function overProgram(event) {
  const r = ui.program.closest(".bar").getBoundingClientRect();
  const pad = 30;
  return event.clientX > r.left - pad && event.clientX < r.right + pad && event.clientY > r.top - pad && event.clientY < r.bottom + pad;
}

// --- game flow ---------------------------------------------------------------

function resetRobot() {
  state.execution += 1;
  state.running = false;
  state.poweredOff = false;
  world.timeScale = 1;
  setRunButton(false);
  showSuccess(false);
  ui.status.textContent = "";
  world.resetRobot();
  renderPath();
  renderProgram();
}

function loadLevel(index) {
  state.level = index;
  state.program = [];
  renderLevelButtons();
  world.build(currentLevel());
  resetRobot();
}

function addCommand(command) {
  if (state.running || !canAdd(currentLevel(), state.program, command)) return;
  if (state.poweredOff) resetRobot();
  state.program = [...state.program, command];
  renderPath();
  renderProgram();
  ui.program.querySelectorAll(".step")[state.program.length - 1]?.classList.add("pop");
}

async function powerDown(activeIndex = -1) {
  state.running = false;
  state.poweredOff = true;
  world.timeScale = 1;
  setRunButton(false);
  if (document.activeElement === ui.run) ui.reset.focus();
  ui.status.textContent = "El robot se quedó sin batería";
  renderProgram(activeIndex, activeIndex !== -1);
  renderPath();
  await world.powerOff();
}

async function runProgram() {
  if (state.running || state.poweredOff || !state.program.length) return;
  resetRobot();
  const execution = state.execution;
  const alive = () => state.running && execution === state.execution;
  const { steps, outcome } = simulate(currentLevel(), state.program);
  if (!steps.length) return;

  state.running = true;
  world.timeScale = pace().timeScale;
  setRunButton(true);
  renderPath();
  renderProgram();

  // One instruction at a time: light it up, then turn, drive one cell and stop.
  for (const step of steps) {
    highlightStep(step.commandIndex);
    await delay(pace().lightMs);
    if (!alive()) return;
    await world.turnTo(step.heading);
    if (!alive()) return;
    if (step.kind === "crash") {
      await world.bump(step);
      if (alive()) powerDown(step.commandIndex);
      return;
    }
    await world.drive(step.from, step.to);
    if (!alive()) return;
    if (step.collect) await world.pickUp(step.collect);
    if (!alive()) return;
    await delay(pace().pauseMs);
    if (!alive()) return;
  }
  highlightStep(-1);

  if (outcome !== "win") return powerDown();

  world.timeScale = 1;
  await world.celebrate();
  if (!alive()) return;
  state.running = false;
  state.completed.add(state.level);
  renderLevelButtons();
  renderProgram();
  setRunButton(false);
  showSuccess(true);
  ui.status.textContent = "El robot encontró la batería";
  ui.next.focus();
}

// --- input -------------------------------------------------------------------

ui.run.addEventListener("click", () => (state.running ? resetRobot() : runProgram()));
ui.reset.addEventListener("click", () => {
  state.program = [];
  resetRobot();
});
ui.speed.addEventListener("click", () => setSlow(!state.slow));
ui.next.addEventListener("click", () => loadLevel((state.level + 1) % LEVELS.length));

window.addEventListener("keydown", (event) => {
  if (!ui.intro.classList.contains("hide")) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      startGame();
    }
    return; // the game ignores keys until it has started
  }
  if (event.target.closest?.("button") && (event.key === "Enter" || event.key === " ")) return;
  const keys = { ArrowUp: "up", ArrowRight: "right", ArrowDown: "down", ArrowLeft: "left", l: "loop" };
  if (keys[event.key]) {
    event.preventDefault();
    addCommand(keys[event.key]);
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    runProgram();
  }
});

// Idle antics: after a few quiet seconds the robot looks around, hops, waves...
// Any tap or key press counts as activity and pushes the next one back.
let lastActivity = performance.now();
let idleDelay = 5000;
for (const type of ["pointerdown", "keydown"]) {
  window.addEventListener(type, () => (lastActivity = performance.now()), true);
}
setInterval(() => {
  const busy = state.running || state.poweredOff || ui.success.classList.contains("show") || !ui.intro.classList.contains("hide") || document.hidden;
  if (busy) lastActivity = performance.now();
  if (busy || performance.now() - lastActivity < idleDelay) return;
  lastActivity = performance.now();
  idleDelay = 5000 + Math.random() * 5000;
  world.idleAntic();
}, 500);

// --- start screen ----------------------------------------------------------

const intro = new Intro(document.querySelector("#intro-canvas"));
world.paused = true; // the board stays still behind the start screen
intro.start();
ui.start.focus();

function startGame() {
  if (ui.intro.classList.contains("hide")) return;
  ui.intro.classList.add("hide");
  ui.intro.inert = true;
  intro.stop();
  world.paused = false;
  lastActivity = performance.now();
  ui.run.focus();
}
ui.start.addEventListener("click", startGame);

buildPalette();
setSlow(state.slow);
loadLevel(0);
