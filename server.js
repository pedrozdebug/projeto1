const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_ROOT = __dirname;
const rooms = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_ROOT, requested));

  if (!filePath.startsWith(PUBLIC_ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": requested.startsWith("/assets/") ? "public, max-age=3600" : "no-store"
    });
    res.end(data);
  });
});

server.on("upgrade", (req, socket) => {
  if (req.headers.upgrade?.toLowerCase() !== "websocket") {
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];
  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  const client = {
    id: crypto.randomUUID(),
    socket,
    roomCode: null,
    name: "",
    skin: "",
    y: 0,
    distance: 0,
    lives: 3,
    alive: false,
    elapsed: 0
  };
  client.buffer = Buffer.alloc(0);

  socket.on("data", (buffer) => {
    client.buffer = Buffer.concat([client.buffer, buffer]);
    const result = readFrames(client.buffer);
    client.buffer = result.remaining;
    result.messages.forEach((message) => handleMessage(client, message));
  });
  socket.on("close", () => removeClient(client));
  socket.on("error", () => removeClient(client));

  send(client, { type: "hello", id: client.id });
});

function handleMessage(client, raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }

  if (message.type === "create_room") {
    const code = createRoomCode();
    const room = {
      code,
      seed: Math.floor(Math.random() * 1_000_000_000),
      createdAt: Date.now(),
      status: "waiting",
      players: new Map()
    };
    rooms.set(code, room);
    joinRoom(client, room, message);
    return;
  }

  if (message.type === "join_room") {
    const code = String(message.code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      send(client, { type: "error", message: "Sala nao encontrada." });
      return;
    }
    joinRoom(client, room, message);
    return;
  }

  const room = rooms.get(client.roomCode);
  if (!room) return;

  if (message.type === "player_update") {
    if (room.status !== "playing") return;
    client.y = finite(message.y, client.y);
    client.distance = Math.max(0, finite(message.distance, client.distance));
    client.lives = Math.max(0, Math.min(3, Math.round(finite(message.lives, client.lives))));
    client.elapsed = Math.max(0, finite(message.elapsed, client.elapsed));
    client.alive = Boolean(message.alive);
    broadcastState(room);
  }

  if (message.type === "start_game") {
    startGame(room);
  }

  if (message.type === "restart") {
    startGame(room);
  }
}

function startGame(room) {
  room.seed = Math.floor(Math.random() * 1_000_000_000);
  room.createdAt = Date.now();
  room.status = "playing";
  for (const player of room.players.values()) {
    player.y = 0;
    player.distance = 0;
    player.lives = 3;
    player.elapsed = 0;
    player.alive = true;
  }
  broadcast(room, { type: "game_started", seed: room.seed, startedAt: room.createdAt });
  broadcastState(room);
}

function joinRoom(client, room, message) {
  removeClient(client);
  client.roomCode = room.code;
  client.name = cleanName(message.name);
  client.skin = cleanSkin(message.skin);
  client.y = 0;
  client.distance = 0;
  client.lives = 3;
  client.alive = room.status === "playing";
  client.elapsed = 0;
  room.players.set(client.id, client);
  send(client, {
    type: "room_joined",
    room: room.code,
    seed: room.seed,
    startedAt: room.createdAt,
    status: room.status,
    id: client.id
  });
  broadcastState(room);
}

function removeClient(client) {
  if (!client.roomCode) return;
  const room = rooms.get(client.roomCode);
  if (room) {
    room.players.delete(client.id);
    if (room.players.size === 0) {
      rooms.delete(room.code);
    } else {
      broadcastState(room);
    }
  }
  client.roomCode = null;
}

function broadcastState(room) {
  const players = [...room.players.values()].map((player) => ({
    id: player.id,
    name: player.name,
    skin: player.skin,
    y: player.y,
    distance: player.distance,
    lives: player.lives,
    alive: player.alive,
    elapsed: player.elapsed
  }));
  broadcast(room, { type: "state", room: room.code, seed: room.seed, status: room.status, players });
}

function broadcast(room, payload) {
  for (const client of room.players.values()) send(client, payload);
}

function send(client, payload) {
  if (client.socket.destroyed) return;
  client.socket.write(writeFrame(JSON.stringify(payload)));
}

function readFrames(buffer) {
  const messages = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const frameStart = offset;
    const byte1 = buffer[offset++];
    const byte2 = buffer[offset++];
    const opcode = byte1 & 0x0f;
    const masked = (byte2 & 0x80) === 0x80;
    let length = byte2 & 0x7f;

    if (length === 126) {
      if (offset + 2 > buffer.length) {
        offset = frameStart;
        break;
      }
      length = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (offset + 8 > buffer.length) {
        offset = frameStart;
        break;
      }
      const high = buffer.readUInt32BE(offset);
      const low = buffer.readUInt32BE(offset + 4);
      length = high * 2 ** 32 + low;
      offset += 8;
    }

    if (!masked || offset + 4 + length > buffer.length) {
      offset = frameStart;
      break;
    }
    const mask = buffer.subarray(offset, offset + 4);
    offset += 4;
    const payload = Buffer.alloc(length);
    for (let index = 0; index < length; index += 1) {
      payload[index] = buffer[offset + index] ^ mask[index % 4];
    }
    offset += length;

    if (opcode === 0x8) break;
    if (opcode === 0x1) messages.push(payload.toString("utf8"));
  }

  return { messages, remaining: buffer.subarray(offset) };
}

function writeFrame(message) {
  const payload = Buffer.from(message);
  const length = payload.length;
  let header;

  if (length < 126) {
    header = Buffer.from([0x81, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  return Buffer.concat([header, payload]);
}

function createRoomCode() {
  let code = "";
  do {
    code = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(code));
  return code;
}

function cleanName(name) {
  const value = String(name || "").trim().slice(0, 14);
  return value || "Player";
}

function cleanSkin(skin) {
  return String(skin || "67.png").replace(/[^a-zA-Z0-9_.-]/g, "");
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

server.listen(PORT, () => {
  console.log(`Jump7 multiplayer rodando em http://localhost:${PORT}`);
});
