(() => {
  "use strict";

  const COLUMNS = 5;
  const ROWS = 4;
  const LEVELS = [
    { start: [1, 1], goal: [2, 1], walls: [], maxCommands: 1, loopAvailable: false },
    { start: [0, 1], goal: [3, 1], walls: [], maxCommands: 3, loopAvailable: false },
    { start: [0, 1], goal: [4, 1], walls: [], maxCommands: 2, loopAvailable: true },
    { start: [1, 2], goal: [4, 2], walls: [], maxCommands: 2, loopAvailable: true },
    {
      start: [0, 0], goal: [3, 3], maxCommands: 3, loopAvailable: true,
      walls: [[2,0],[3,0],[4,0],[0,1],[3,1],[4,1],[0,2],[1,2],[4,2],[0,3],[1,3],[2,3],[4,3]],
    },
    {
      start: [0, 0], goal: [3, 3], maxCommands: 3, loopAvailable: true,
      walls: [[1,0],[2,0],[3,0],[4,0],[2,1],[3,1],[4,1],[0,2],[3,2],[4,2],[0,3],[1,3],[4,3]],
    },
  ];

  const COMMANDS = {
    up: { x: 0, y: -1, symbol: "↑" },
    right: { x: 1, y: 0, symbol: "→" },
    down: { x: 0, y: 1, symbol: "↓" },
    left: { x: -1, y: 0, symbol: "←" },
    loop: { symbol: "∞" },
  };

  const state = {
    level: 0,
    program: [],
    position: { x: 0, y: 0 },
    running: false,
    poweredOff: false,
    execution: 0,
    completed: new Set(),
  };

  const ui = {
    board: document.querySelector("#board"),
    program: document.querySelector("#program"),
    run: document.querySelector("#run"),
    reset: document.querySelector("#reset"),
    loopCommand: document.querySelector("#loop-command"),
    success: document.querySelector("#success"),
    next: document.querySelector("#next"),
    status: document.querySelector("#status"),
    commands: [...document.querySelectorAll(".command")],
    levels: [...document.querySelectorAll(".level")],
  };

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const key = (x, y) => `${x},${y}`;
  const currentLevel = () => LEVELS[state.level];

  function isWall(x, y) {
    return currentLevel().walls.some(([wallX, wallY]) => wallX === x && wallY === y);
  }

  function splitProgram() {
    const loopIndex = state.program.indexOf("loop");
    return {
      loopIndex,
      movements: state.program.slice(0, loopIndex === -1 ? state.program.length : loopIndex),
    };
  }

  function programRoute() {
    const level = currentLevel();
    const { loopIndex, movements } = splitProgram();
    const repeats = loopIndex === -1 ? 1 : 20;
    const points = [{ x: level.start[0], y: level.start[1] }];
    let x = level.start[0];
    let y = level.start[1];

    for (let repeat = 0; repeat < repeats; repeat++) {
      for (const command of movements) {
        const movement = COMMANDS[command];
        const nextX = x + movement.x;
        const nextY = y + movement.y;
        const outside = nextX < 0 || nextX >= COLUMNS || nextY < 0 || nextY >= ROWS;
        if (outside || isWall(nextX, nextY)) return points;
        x = nextX;
        y = nextY;
        points.push({ x, y });
        if (x === level.goal[0] && y === level.goal[1]) return points;
      }
      if (!movements.length) break;
    }
    return points;
  }

  function renderPathPreview() {
    if (state.running) return;
    const points = programRoute();
    if (points.length < 2) return;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    svg.classList.add("path-preview");
    svg.setAttribute("viewBox", `0 0 ${COLUMNS} ${ROWS}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    path.setAttribute("points", points.map(({ x, y }) => `${x + .5},${y + .5}`).join(" "));
    path.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(path);
    ui.board.appendChild(svg);
  }

  function renderBoard(bump = null) {
    const level = currentLevel();
    ui.board.replaceChildren();
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLUMNS; x++) {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.setAttribute("role", "gridcell");
        if (isWall(x, y)) {
          cell.classList.add("wall");
          cell.textContent = "■";
          cell.setAttribute("aria-label", "Pared");
        } else if (state.position.x === x && state.position.y === y) {
          cell.classList.add("robot");
          cell.classList.toggle("off", state.poweredOff);
          cell.textContent = "🤖";
          cell.setAttribute("aria-label", state.poweredOff ? "Robot sin batería" : "Robot");
        } else if (level.goal[0] === x && level.goal[1] === y) {
          cell.classList.add("goal");
          cell.textContent = "🔋";
          cell.setAttribute("aria-label", "Batería");
        } else {
          cell.textContent = "·";
          cell.setAttribute("aria-label", "Vacío");
        }
        if (bump === key(x, y)) cell.classList.add("bump");
        ui.board.appendChild(cell);
      }
    }
    renderPathPreview();
  }

  function renderProgram(activeIndex = -1) {
    ui.program.replaceChildren();
    state.program.forEach((command, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `step command-${command}`;
      button.textContent = COMMANDS[command].symbol;
      button.setAttribute("aria-label", `Quitar ${command}`);
      button.classList.toggle("active", index === activeIndex);
      button.addEventListener("click", () => {
        if (state.running) return;
        state.program.splice(index, 1);
        if (state.program[0] === "loop") state.program = [];
        resetRobot();
      });
      ui.program.appendChild(button);
    });
    for (let index = state.program.length; index < currentLevel().maxCommands; index++) {
      const slot = document.createElement("span");
      slot.className = "empty-slot";
      slot.setAttribute("aria-hidden", "true");
      ui.program.appendChild(slot);
    }
  }

  function updateLevelButtons() {
    ui.levels.forEach((button, index) => {
      button.classList.toggle("active", index === state.level);
      button.classList.toggle("done", state.completed.has(index));
    });
  }

  function updateLevelControls() {
    const available = currentLevel().loopAvailable;
    ui.loopCommand.disabled = !available;
    ui.loopCommand.classList.toggle("hidden", !available);
  }

  function resetRobot() {
    state.execution += 1;
    const [x, y] = currentLevel().start;
    state.position = { x, y };
    state.running = false;
    state.poweredOff = false;
    ui.run.classList.remove("running");
    ui.run.textContent = "▶";
    ui.success.classList.remove("show");
    ui.success.setAttribute("aria-hidden", "true");
    ui.status.textContent = "";
    renderBoard();
    renderProgram();
  }

  function clearAndReset() {
    state.program = [];
    resetRobot();
  }

  function loadLevel(index) {
    state.level = index;
    state.program = [];
    updateLevelButtons();
    updateLevelControls();
    resetRobot();
  }

  function addCommand(command) {
    if (state.running || state.program.length >= currentLevel().maxCommands) return;
    if (command === "loop" && (!currentLevel().loopAvailable || !state.program.length || state.program.includes("loop"))) return;
    if (command !== "loop" && state.program.includes("loop")) return;
    if (state.poweredOff) resetRobot();
    state.program.push(command);
    renderBoard();
    renderProgram();
  }

  function powerDown(bump = null) {
    state.running = false;
    state.poweredOff = true;
    ui.run.classList.remove("running");
    ui.run.textContent = "▶";
    ui.status.textContent = "El robot se quedó sin batería";
    renderBoard(bump);
    renderProgram();
  }

  async function runProgram() {
    if (state.running || !state.program.length) return;
    resetRobot();
    const execution = state.execution;
    const { loopIndex, movements } = splitProgram();
    if (!movements.length) return;
    state.running = true;
    ui.run.classList.add("running");
    ui.run.textContent = "■";
    renderBoard();

    const maxSteps = loopIndex === -1 ? movements.length : movements.length * 20;
    for (let step = 0; step < maxSteps; step++) {
      if (!state.running) return;
      const index = step % movements.length;
      renderProgram(index);
      await delay(320);
      if (!state.running || execution !== state.execution) return;

      const movement = COMMANDS[movements[index]];
      const nextX = state.position.x + movement.x;
      const nextY = state.position.y + movement.y;
      const outside = nextX < 0 || nextX >= COLUMNS || nextY < 0 || nextY >= ROWS;
      if (outside || isWall(nextX, nextY)) {
        powerDown(outside ? key(state.position.x, state.position.y) : key(nextX, nextY));
        return;
      }

      state.position = { x: nextX, y: nextY };
      renderBoard();
      await delay(360);
      if (!state.running || execution !== state.execution) return;

      const [goalX, goalY] = currentLevel().goal;
      if (nextX === goalX && nextY === goalY) {
        state.running = false;
        state.completed.add(state.level);
        updateLevelButtons();
        renderProgram();
        ui.run.classList.remove("running");
        ui.run.textContent = "▶";
        ui.success.classList.add("show");
        ui.success.setAttribute("aria-hidden", "false");
        ui.status.textContent = "El robot encontró la batería";
        return;
      }

      if (loopIndex === -1 && index === movements.length - 1) break;
    }
    powerDown();
  }

  ui.commands.forEach((button) => button.addEventListener("click", () => addCommand(button.dataset.command)));
  ui.levels.forEach((button) => button.addEventListener("click", () => loadLevel(Number(button.dataset.level))));
  ui.run.addEventListener("click", () => state.running ? resetRobot() : runProgram());
  ui.reset.addEventListener("click", clearAndReset);
  ui.next.addEventListener("click", () => loadLevel((state.level + 1) % LEVELS.length));

  window.addEventListener("keydown", (event) => {
    const keys = { ArrowUp: "up", ArrowRight: "right", ArrowDown: "down", ArrowLeft: "left" };
    if (keys[event.key]) {
      event.preventDefault();
      addCommand(keys[event.key]);
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      runProgram();
    }
  });

  loadLevel(0);
})();
