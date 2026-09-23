const http = require("node:http");
const crypto = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.length === b.length &&
  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
function iceServers(config, room) {
  if (!config.turnHost || !config.turnSecret) return [];
  const username = `${Math.floor(Date.now() / 1000) + 86400}:${room}`;
  return [
    { urls: `stun:${config.turnHost}:3478` },
    {
      urls: [
        `turn:${config.turnHost}:3478?transport=udp`,
        `turn:${config.turnHost}:3478?transport=tcp`,
      ],
      username,
      credential: crypto
        .createHmac("sha1", config.turnSecret)
        .update(username)
        .digest("base64"),
    },
  ];
}
function createBroker(config = {}) {
  const rooms = new Map(),
    pending = new Map();
  const server = http.createServer((req, res) => {
    res.writeHead(req.url === "/health" ? 200 : 404, {
      "Content-Type": "text/plain",
    });
    res.end(req.url === "/health" ? "Prestera relay ready\n" : "Not found");
  });
  const wss = new WebSocketServer({
    server,
    path: "/relay",
    maxPayload: 262144,
    perMessageDeflate: false,
  });
  const send = (ws, msg) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  const reject = (ws) => {
    send(ws, {
      type: "error",
      message: "VPS недоступен, ключ неверен или комната закрыта",
    });
    ws.close(1008);
  };
  wss.on("connection", (ws) => {
    ws.on("error", () => {});
    ws.alive = true;
    ws.on("pong", () => {
      ws.alive = true;
    });
    if (wss.clients.size > (config.maxConnections || 256))
      return ws.terminate();
    const timer = setTimeout(() => ws.terminate(), 10000);
    let membership,
      partner,
      windowStart = Date.now(),
      bytes = 0,
      requests = 0;
    ws.on("message", (data, binary) => {
      try {
        if (Date.now() - windowStart >= 1000) {
          windowStart = Date.now();
          bytes = 0;
          requests = 0;
        }
        bytes += data.length;
        if (bytes > 2 ** 20 || ++requests > 200) return ws.terminate();
        if (partner) {
          if (
            !binary ||
            partner.readyState !== WebSocket.OPEN ||
            partner.bufferedAmount > 2 ** 20
          )
            return ws.terminate();
          partner.send(data, { binary: true });
          return;
        }
        if (membership || binary || data.length > 4096) return reject(ws);
        const m = JSON.parse(data);
        if (m.type === "host") {
          if (
            !config.serverKey ||
            !equal(m.serverKey, config.serverKey) ||
            !/^[a-f0-9]{32}$/.test(m.room || "") ||
            !/^[a-f0-9]{64}$/.test(m.token || "") ||
            rooms.has(m.room) ||
            rooms.size >= (config.maxRooms || 32)
          )
            return reject(ws);
          const room = {
            owner: ws,
            token: m.token,
            sockets: new Set(),
            created: Date.now(),
          };
          rooms.set(m.room, room);
          membership = { role: "host", id: m.room, room };
          clearTimeout(timer);
          send(ws, { type: "ready", iceServers: iceServers(config, m.room) });
        } else if (m.type === "join") {
          const room = rooms.get(m.room);
          if (!room || !equal(m.token, room.token) || room.sockets.size >= 14)
            return reject(ws);
          membership = { role: "guest", id: m.room, room };
          room.sockets.add(ws);
          const ticket = crypto.randomBytes(24).toString("hex");
          pending.set(ticket, {
            ws,
            room,
            roomId: m.room,
            pair: (other) => {
              partner = other;
              clearTimeout(timer);
            },
          });
          membership.ticket = ticket;
          send(room.owner, { type: "connect", ticket });
        } else if (m.type === "attach") {
          const entry = pending.get(m.ticket);
          if (
            !entry ||
            entry.roomId !== m.room ||
            !equal(entry.room.token, m.token)
          )
            return reject(ws);
          pending.delete(m.ticket);
          membership = { role: "tunnel", id: m.room, room: entry.room };
          entry.room.sockets.add(ws);
          partner = entry.ws;
          entry.pair(ws);
          clearTimeout(timer);
          send(ws, { type: "ready" });
          send(partner, { type: "ready" });
        } else reject(ws);
      } catch {
        reject(ws);
      }
    });
    ws.on("close", () => {
      clearTimeout(timer);
      partner?.terminate();
      if (!membership) return;
      const { role, id, room, ticket } = membership;
      if (ticket) pending.delete(ticket);
      room.sockets.delete(ws);
      if (role === "host") {
        rooms.delete(id);
        for (const connection of room.sockets) connection.terminate();
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) ws.terminate();
      else {
        ws.alive = false;
        ws.ping();
      }
    }
    // Close before 24-hour TURN credentials expire. Recreating gives fresh keys.
    for (const room of rooms.values())
      if (Date.now() - room.created > 23 * 3600000) room.owner.terminate();
  }, 15000);
  return {
    server,
    rooms,
    async close() {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      await new Promise((r) => wss.close(r));
      await new Promise((r) => server.close(r));
    },
  };
}
if (require.main === module) {
  const config = {
    serverKey: process.env.PRESTERA_SERVER_KEY,
    turnHost: process.env.TURN_HOST,
    turnSecret: process.env.TURN_SECRET,
  };
  if (!config.serverKey || config.serverKey.length < 32)
    throw new Error("PRESTERA_SERVER_KEY must contain at least 32 characters");
  const broker = createBroker(config);
  broker.server.listen(Number(process.env.PORT || 8787), "127.0.0.1", () =>
    console.log("Prestera signaling listening on 127.0.0.1:8787"),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      await broker.close();
      process.exit(0);
    });
}
module.exports = { createBroker, iceServers };
