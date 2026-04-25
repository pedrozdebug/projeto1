const skins = ["67.png", "foot.png", "nahiegg.png", "thukunais.png"];
const skinPath = (skin) => `/assets/skins/${skin}`;

const menu = document.querySelector("#menu");
const lobby = document.querySelector("#lobby");
const game = document.querySelector("#game");
const skinGrid = document.querySelector("#skinGrid");
const statusText = document.querySelector("#status");
const playerNameInput = document.querySelector("#playerName");
const roomCodeInput = document.querySelector("#roomCode");
const createRoomButton = document.querySelector("#createRoom");
const joinRoomButton = document.querySelector("#joinRoom");
const copyCodeButton = document.querySelector("#copyCode");
const lobbyCodeButton = document.querySelector("#lobbyCode");
const lobbyPlayersEl = document.querySelector("#lobbyPlayers");
const startGameButton = document.querySelector("#startGame");
const leaveLobbyButton = document.querySelector("#leaveLobby");
const timerEl = document.querySelector("#timer");
const distanceEl = document.querySelector("#distance");
const livesEl = document.querySelector("#lives");
const speedEl = document.querySelector("#speed");
const playersEl = document.querySelector("#players");
const dangerWarningEl = document.querySelector("#dangerWarning");
const jumpButton = document.querySelector("#jumpButton");
const gameOverEl = document.querySelector("#gameOver");
const scoreboardEl = document.querySelector("#scoreboard");
const restartButton = document.querySelector("#restart");
const canvas = document.querySelector("#gameCanvas");
const ctx = canvas.getContext("2d");

const GAME_WIDTH = 390;
const GAME_HEIGHT = 844;
const images = new Map();
const backgroundImage = loadImage("background", "/assets/mapa/fundo/fundo.png");
const obstacleSprites = ["planeta1.png", "planeta2.png", "planeta3.png", "planeta4.png", "lua.png"];
const obstacleImages = new Map(obstacleSprites.map((name) => [name, loadImage(name, `/assets/mapa/obstaculos/${name}`)]));
const blackHoleImage = loadImage("buraconegro.png", "/assets/mapa/obstaculos/buraconegro.png");
const blackHoleInterval = 50 * 50;
const blackHoleWarningDistance = 720;
const blackHolePullRadius = 200;
const blackHolePullForce = 3600;
const obstacleSizeMultiplier = 1.5;
const state = {
  socket: null,
  id: "",
  room: "",
  seed: 1,
  roomStatus: "menu",
  selectedSkin: skins[0],
  players: new Map(),
  running: false,
  gameOver: false,
  lastTime: performance.now(),
  sendClock: 0,
  world: {
    distance: 0,
    elapsed: 0,
    speed: 185,
    y: 0,
    velocity: 0,
    lives: 3,
    alive: true,
    invulnerable: 0
  }
};

for (const skin of skins) {
  const image = loadImage(skin, skinPath(skin));
  images.set(skin, image);

  const button = document.createElement("button");
  button.className = "skin-option";
  button.type = "button";
  button.title = skin.replace(".png", "");
  button.innerHTML = `<img src="${skinPath(skin)}" alt="${button.title}">`;
  button.addEventListener("click", () => selectSkin(skin));
  skinGrid.append(button);
}

selectSkin(state.selectedSkin);
resize();
connect();
requestAnimationFrame(loop);

window.addEventListener("resize", resize);
window.addEventListener("keydown", (event) => {
  if (event.code === "Space" || event.code === "ArrowUp") {
    event.preventDefault();
    jump();
  }
});
canvas.addEventListener("pointerdown", jump);
jumpButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  jump();
});
createRoomButton.addEventListener("click", () => sendRoomAction("create_room"));
joinRoomButton.addEventListener("click", () => sendRoomAction("join_room"));
roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});
copyCodeButton.addEventListener("click", async () => {
  copyRoomCode(copyCodeButton);
});
lobbyCodeButton.addEventListener("click", () => copyRoomCode(lobbyCodeButton));
startGameButton.addEventListener("click", () => send({ type: "start_game" }));
leaveLobbyButton.addEventListener("click", () => location.reload());
restartButton.addEventListener("click", () => {
  send({ type: "restart" });
  gameOverEl.classList.add("is-hidden");
});

function connect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  state.socket = new WebSocket(`${protocol}://${location.host}`);

  state.socket.addEventListener("open", () => {
    statusText.textContent = "Conectado. Crie uma sala ou entre com um codigo.";
  });

  state.socket.addEventListener("close", () => {
    statusText.textContent = "Conexao caiu. Tentando reconectar...";
    state.running = false;
    setTimeout(connect, 900);
  });

  state.socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    handleServerMessage(message);
  });
}

function handleServerMessage(message) {
  if (message.type === "hello") {
    state.id = message.id;
  }

  if (message.type === "error") {
    statusText.textContent = message.message;
  }

  if (message.type === "room_joined") {
    state.id = message.id;
    state.room = message.room;
    state.seed = message.seed;
    state.roomStatus = message.status;
    copyCodeButton.textContent = state.room;
    lobbyCodeButton.textContent = state.room;
    if (message.status === "playing") {
      startRace();
    } else {
      showLobby();
    }
  }

  if (message.type === "game_started" || message.type === "restart") {
    state.seed = message.seed;
    state.roomStatus = "playing";
    startRace();
    gameOverEl.classList.add("is-hidden");
  }

  if (message.type === "state") {
    state.seed = message.seed;
    state.roomStatus = message.status;
    state.players.clear();
    for (const player of message.players) {
      state.players.set(player.id, player);
    }
    renderPlayerList();
    if (state.roomStatus === "playing") {
      checkForGameOver();
    }
  }
}

function selectSkin(skin) {
  state.selectedSkin = skin;
  document.querySelectorAll(".skin-option").forEach((button, index) => {
    button.classList.toggle("is-selected", skins[index] === skin);
  });
}

function sendRoomAction(type) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    statusText.textContent = "Ainda conectando ao servidor.";
    return;
  }

  const code = roomCodeInput.value.trim().toUpperCase();
  if (type === "join_room" && code.length < 4) {
    statusText.textContent = "Digite o codigo da sala.";
    return;
  }

  send({
    type,
    code,
    name: playerNameInput.value,
    skin: state.selectedSkin
  });
}

function showLobby() {
  menu.classList.add("is-hidden");
  lobby.classList.remove("is-hidden");
  game.classList.remove("is-hidden");
  gameOverEl.classList.add("is-hidden");
  dangerWarningEl.classList.add("is-hidden");
  state.running = false;
  updateHud();
}

function startRace() {
  resetWorld();
  menu.classList.add("is-hidden");
  lobby.classList.add("is-hidden");
  game.classList.remove("is-hidden");
  state.running = true;
}

function resetWorld() {
  state.world.distance = 0;
  state.world.elapsed = 0;
  state.world.speed = 185;
  state.world.y = canvas.height * 0.42;
  state.world.velocity = 0;
  state.world.lives = 3;
  state.world.alive = true;
  state.world.invulnerable = 1.2;
  state.gameOver = false;
  state.lastTime = performance.now();
}

function jump() {
  if (!state.running || !state.world.alive) return;
  state.world.velocity = -430;
}

function loop(now) {
  const delta = Math.min(0.033, (now - state.lastTime) / 1000 || 0);
  state.lastTime = now;

  if (state.running && !state.gameOver) update(delta);
  draw();
  requestAnimationFrame(loop);
}

function update(delta) {
  const world = state.world;
  if (world.alive) {
    world.elapsed += delta;
    world.speed = 185 + world.elapsed * 7.5;
    world.distance += world.speed * delta;
    world.velocity += 1120 * delta;
    applyBlackHolePull(delta);
    world.y += world.velocity * delta;
    world.invulnerable = Math.max(0, world.invulnerable - delta);

    const radius = playerRadius();
    const floor = canvas.height - groundHeight() - radius;
    const ceiling = radius + safeTop();
    if (world.y > floor) {
      world.y = floor;
      hitObstacle();
    }
    if (world.y < ceiling) {
      world.y = ceiling;
      world.velocity = 80;
    }

    updateBlackHoleWarning();

    if (world.invulnerable <= 0 && collidesWithObstacle()) {
      hitObstacle();
    }
  }

  state.sendClock += delta;
  if (state.sendClock > 0.045) {
    state.sendClock = 0;
    send({
      type: "player_update",
      y: state.world.y / canvas.height,
      distance: state.world.distance,
      lives: state.world.lives,
      alive: state.world.alive,
      elapsed: state.world.elapsed
    });
  }

  updateHud();
}

function hitObstacle() {
  const world = state.world;
  if (world.invulnerable > 0 || !world.alive) return;
  world.lives -= 1;
  world.invulnerable = 1.25;
  world.velocity = -300;

  if (world.lives <= 0) {
    world.lives = 0;
    world.alive = false;
    world.velocity = 0;
  }
}

function collidesWithObstacle() {
  const radius = playerRadius() * 0.78;
  const x = playerX();
  const y = state.world.y;
  return visibleObstacles().some((obstacle) => circleCircle(x, y, radius, obstacle.x, obstacle.y, obstacle.radius));
}

function circleCircle(ax, ay, ar, bx, by, br) {
  const dx = ax - bx;
  const dy = ay - by;
  const distance = Math.hypot(dx, dy);
  return distance < ar + br;
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackground();
  drawObstacles();
  drawPlayers();
  drawGround();
}

function drawBackground() {
  const w = canvas.width;
  const h = canvas.height;
  const image = backgroundImage;

  if (image.complete && image.naturalWidth) {
    const scale = Math.max(h / image.naturalHeight, w / image.naturalWidth);
    const tileW = image.naturalWidth * scale;
    const tileH = image.naturalHeight * scale;
    const offset = -((state.world.distance * 0.22) % tileW);

    for (let x = offset - tileW; x < w + tileW; x += tileW) {
      ctx.drawImage(image, x, (h - tileH) / 2, tileW, tileH);
    }
  } else {
    ctx.fillStyle = "#101426";
    ctx.fillRect(0, 0, w, h);
  }
}

function drawGround() {
  ctx.fillStyle = "rgba(7, 10, 20, 0.2)";
  ctx.fillRect(0, canvas.height - groundHeight(), canvas.width, groundHeight());
}

function drawObstacles() {
  for (const obstacle of visibleObstacles()) {
    const image = obstacle.type === "blackhole" ? blackHoleImage : obstacleImages.get(obstacle.sprite);
    const size = obstacle.radius * 2;

    if (obstacle.type === "blackhole") {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#6e45d8";
      ctx.beginPath();
      ctx.arc(obstacle.x, obstacle.y, blackHolePullRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (image?.complete && image.naturalWidth) {
      drawCenteredImage(image, obstacle.x, obstacle.y, size, obstacle.rotation);
    } else {
      ctx.fillStyle = obstacle.type === "blackhole" ? "#12091f" : "#65717a";
      ctx.beginPath();
      ctx.arc(obstacle.x, obstacle.y, obstacle.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawPlayers() {
  const local = {
    id: state.id,
    name: playerNameInput.value || "Player",
    skin: state.selectedSkin,
    y: state.world.y / canvas.height,
    distance: state.world.distance,
    alive: state.world.alive
  };
  const players = [...state.players.values()].filter((player) => player.id !== state.id);

  for (const player of players) {
    drawPlayer(player, 0.5);
  }
  drawPlayer(local, state.world.invulnerable > 0 && Math.floor(performance.now() / 90) % 2 === 0 ? 0.55 : 1);
}

function drawPlayer(player, alpha) {
  const image = images.get(player.skin) || images.get(skins[0]);
  const size = playerRadius() * 2.15;
  const x = player.id === state.id ? playerX() : playerX() + (player.distance - state.world.distance) * worldScale();
  const y = player.id === state.id ? state.world.y : player.y * canvas.height;

  if (x < -80 || x > canvas.width + 120) return;

  ctx.save();
  ctx.globalAlpha = player.alive ? alpha : alpha * 0.35;
  ctx.translate(x, y);
  ctx.rotate(Math.max(-0.45, Math.min(0.7, state.world.velocity / 900)));
  ctx.drawImage(image, -size / 2, -size / 2, size, size);
  ctx.restore();
}

function visibleObstacles() {
  const spacing = obstacleSpacing();
  const scale = worldScale();
  const start = Math.max(0, Math.floor((state.world.distance - playerX() / scale - 120) / spacing) - 1);
  const end = start + Math.ceil(canvas.width / (spacing * scale)) + 5;
  const obstacles = [];

  for (let index = start; index <= end; index += 1) {
    const worldX = 520 + index * spacing;
    const screenX = playerX() + (worldX - state.world.distance) * scale;
    obstacles.push(...makeObstacle(index, screenX));
  }

  obstacles.push(...visibleBlackHoles());
  return obstacles;
}

function makeObstacle(index, x) {
  const random = seededRandom(state.seed + index * 1013);
  const h = canvas.height;
  const top = safeTop() + 28;
  const bottom = h - groundHeight() - 20;
  const playHeight = bottom - top;
  const radius = Math.max(26, Math.min(54, canvas.width * 0.045)) * obstacleSizeMultiplier;
  const obstacles = [];

  obstacles.push(makeSpriteObstacle(random, x, top + radius * 0.7, radius * randomObstacleScale(random)));
  obstacles.push(makeSpriteObstacle(random, x + (random() - 0.5) * 42, bottom - radius * 0.7, radius * randomObstacleScale(random)));

  const middleCount = random() > 0.35 ? 2 : 1;
  for (let i = 0; i < middleCount; i += 1) {
    const y = top + playHeight * (0.24 + random() * 0.52);
    const offsetX = (random() - 0.5) * 86;
    obstacles.push(makeSpriteObstacle(random, x + offsetX, y, radius * randomObstacleScale(random)));
  }

  return obstacles;
}

function makeSpriteObstacle(random, x, y, radius) {
  return {
    type: "sprite",
    sprite: obstacleSprites[Math.floor(random() * obstacleSprites.length)],
    x,
    y,
    radius,
    rotation: random() * Math.PI * 2
  };
}

function randomObstacleScale(random) {
  return 0.9 + random() * 0.22;
}

function visibleBlackHoles() {
  const scale = worldScale();
  const first = Math.max(1, Math.floor((state.world.distance - 900) / blackHoleInterval));
  const last = Math.ceil((state.world.distance + canvas.width / scale + 900) / blackHoleInterval);
  const holes = [];

  for (let index = first; index <= last; index += 1) {
    const random = seededRandom(state.seed + index * 7919);
    const worldX = index * blackHoleInterval;
    const screenX = playerX() + (worldX - state.world.distance) * scale;
    const minY = safeTop() + 110;
    const maxY = canvas.height - groundHeight() - 110;
    holes.push({
      type: "blackhole",
      x: screenX,
      y: minY + random() * Math.max(90, maxY - minY),
      radius: Math.max(44, Math.min(72, canvas.width * 0.06)),
      rotation: performance.now() / 650
    });
  }

  return holes;
}

function applyBlackHolePull(delta) {
  const x = playerX();
  const y = state.world.y;

  for (const hole of visibleBlackHoles()) {
    const dx = hole.x - x;
    const dy = hole.y - y;
    const distance = Math.hypot(dx, dy);

    if (distance < blackHolePullRadius && distance > 1) {
      const pull = 1 - distance / blackHolePullRadius;
      const force = pull * pull * blackHolePullForce;
      state.world.velocity += (dy / distance) * force * delta;
      state.world.distance = Math.max(
        0,
        state.world.distance + Math.max(-180, Math.min(260, (dx / distance) * force * delta * 0.42))
      );
    }
  }
}

function updateBlackHoleWarning() {
  const nextHole = visibleBlackHoles().find((hole) => hole.x > playerX() && hole.x - playerX() < blackHoleWarningDistance);
  dangerWarningEl.classList.toggle("is-hidden", !nextHole);
}

function renderPlayerList() {
  const rows = [...state.players.values()].sort((a, b) => b.distance - a.distance);
  playersEl.innerHTML = "";
  lobbyPlayersEl.innerHTML = "";
  for (const player of rows) {
    playersEl.append(createPlayerRow(player, `${Math.floor(player.distance)}m`));
    lobbyPlayersEl.append(createPlayerRow(player, player.alive ? "pronto" : "espera"));
  }
}

function createPlayerRow(player, value) {
  const row = document.createElement("div");
  row.className = "player-row";
  row.innerHTML = `
    <img src="${skinPath(player.skin)}" alt="">
    <span>${escapeHtml(player.name)}${player.id === state.id ? " (voce)" : ""}</span>
    <strong>${value}</strong>
  `;
  return row;
}

function checkForGameOver() {
  const players = [...state.players.values()];
  if (!players.length) return;
  const allDead = players.every((player) => !player.alive || player.lives <= 0);
  if (!allDead || state.gameOver) return;

  state.gameOver = true;
  const ranking = players.sort((a, b) => b.distance - a.distance);
  scoreboardEl.innerHTML = "";
  for (const player of ranking) {
    const item = document.createElement("li");
    item.textContent = `${player.name}: ${Math.floor(player.distance)} m`;
    scoreboardEl.append(item);
  }
  gameOverEl.classList.remove("is-hidden");
}

function updateHud() {
  timerEl.textContent = formatTime(state.world.elapsed);
  distanceEl.textContent = `${Math.floor(state.world.distance)} m`;
  livesEl.textContent = `${state.world.lives} ${state.world.lives === 1 ? "vida" : "vidas"}`;
  speedEl.textContent = `${(state.world.speed / 185).toFixed(1)}x`;
}

async function copyRoomCode(button) {
  try {
    await navigator.clipboard.writeText(state.room);
    button.textContent = "Copiado";
    setTimeout(() => (button.textContent = state.room), 900);
  } catch {
    button.textContent = state.room;
  }
}

function resize() {
  canvas.width = GAME_WIDTH;
  canvas.height = GAME_HEIGHT;

  const scale = Math.min(window.innerWidth / GAME_WIDTH, window.innerHeight / GAME_HEIGHT);
  canvas.style.width = `${GAME_WIDTH * scale}px`;
  canvas.style.height = `${GAME_HEIGHT * scale}px`;

  if (!state.running) {
    state.world.y = canvas.height * 0.42;
  }
}

function send(payload) {
  if (state.socket?.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify(payload));
  }
}

function playerX() {
  return Math.max(96, canvas.width * 0.22);
}

function playerRadius() {
  return Math.max(18, Math.min(30, canvas.width * 0.035));
}

function groundHeight() {
  return Math.max(56, canvas.height * 0.1);
}

function safeTop() {
  return canvas.width < 720 ? 104 : 72;
}

function worldScale() {
  return Math.max(0.78, Math.min(1.1, canvas.width / 980));
}

function obstacleSpacing() {
  return Math.max(360, Math.min(470, canvas.width * 0.48));
}

function formatTime(seconds) {
  const total = Math.floor(seconds);
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const secs = String(total % 60).padStart(2, "0");
  return `${minutes}:${secs}`;
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function loadImage(key, src) {
  const image = new Image();
  image.src = src;
  image.dataset.key = key;
  return image;
}

function drawCenteredImage(image, x, y, maxSize, rotation = 0) {
  const aspect = image.naturalWidth / image.naturalHeight;
  const width = aspect >= 1 ? maxSize : maxSize * aspect;
  const height = aspect >= 1 ? maxSize / aspect : maxSize;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char];
  });
}
