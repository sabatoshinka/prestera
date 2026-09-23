const { WebSocketServer, WebSocket } = require("ws");
const { EventEmitter } = require("node:events");
const crypto = require("node:crypto");
const dgram = require("node:dgram");
const os = require("node:os");
const https = require("node:https");
const tls = require("node:tls");
const { joinRelay } = require("./relay.cjs");
const {
  PSK_IDENTITY,
  TLS_OPTIONS,
  clientTlsOptions,
  verifyTransport,
} = require("./security.cjs");

const MAX_PEERS = 8;
function parseInvite(value) {
  const raw = String(value).trim();
  let host, port, key;
  if (/^(pibble|prestera):\/\//.test(raw)) {
    const url = new URL(raw);
    if (url.hostname !== "join") throw new Error("Неверное приглашение");
    host = url.searchParams.get("host");
    port = url.searchParams.get("port");
    key = url.searchParams.get("key");
  } else {
    const [address, secret] = raw.split("#");
    const split = address.lastIndexOf(":");
    host = split < 0 ? address : address.slice(0, split);
    port = split < 0 ? "45454" : address.slice(split + 1);
    key = secret;
  }
  if (!host || !/^[a-zA-Z0-9.\-]+$/.test(host) || host.length > 253)
    throw new Error("Укажи IPv4-адрес или имя компьютера");
  if (!/^\d+$/.test(String(port)) || +port < 1024 || +port > 65535)
    throw new Error("Порт должен быть от 1024 до 65535");
  if (!/^[a-f0-9]{64}$/i.test(key || ""))
    throw new Error("В приглашении не хватает ключа комнаты");
  return { host, port: +port, key };
}
function inviteFor(host, port, key) {
  return `prestera://join?host=${encodeURIComponent(host)}&port=${port}&key=${key}`;
}
function localAddresses() {
  return [
    ...new Set(
      Object.values(os.networkInterfaces())
        .flat()
        .filter((i) => i && i.family === "IPv4" && !i.internal)
        .map((i) => i.address),
    ),
  ];
}
// RFC 5389 Binding service on the room host. No third-party discovery service.
function bindingResponse(request, address, port) {
  if (
    request.length < 20 ||
    request.length > 1024 ||
    request.readUInt16BE(0) !== 1 ||
    request.readUInt32BE(4) !== 0x2112a442 ||
    request.readUInt16BE(2) !== request.length - 20
  )
    return null;
  const ip = address.split(".").map(Number);
  if (
    ip.length !== 4 ||
    ip.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  )
    return null;
  const out = Buffer.alloc(32);
  out.writeUInt16BE(0x0101, 0);
  out.writeUInt16BE(12, 2);
  out.writeUInt32BE(0x2112a442, 4);
  request.copy(out, 8, 8, 20);
  out.writeUInt16BE(0x0020, 20);
  out.writeUInt16BE(8, 22);
  out[25] = 1;
  out.writeUInt16BE(port ^ 0x2112, 26);
  ip.forEach((n, i) => {
    out[28 + i] = n ^ out[4 + i];
  });
  return out;
}
async function createRoom({
  port = 45454,
  name = "Комната",
  loopback = false,
  iceServers = null,
} = {}) {
  if (
    !Number.isInteger(port) ||
    (!(loopback && port === 0) && port < 1024) ||
    port > 65535
  )
    throw new Error("Неверный порт");
  const key = crypto.randomBytes(32),
    keyHex = key.toString("hex"),
    roomId = crypto.randomUUID();
  const server = https.createServer(
    {
      ...TLS_OPTIONS,
      handshakeTimeout: 8000,
      headersTimeout: 8000,
      requestTimeout: 8000,
      maxHeaderSize: 8192,
      pskCallback: (_socket, identity) =>
        identity === PSK_IDENTITY ? key : null,
    },
    (_request, response) => {
      response.writeHead(404, { Connection: "close" });
      response.end();
    },
  );
  // Every connection must do a fresh ECDHE exchange. No ticket or ID resumption.
  server.on("resumeSession", (_id, callback) => callback(null, null));
  server.on("newSession", (_id, _data, callback) => callback());
  server.on("tlsClientError", (_error, socket) => socket.destroy());
  server.on("clientError", (_error, socket) => socket.destroy());
  server.on("error", () => {});
  server.maxConnections = 24;
  // Apply the HTTP idle deadline to the TLS socket. ws clears that deadline
  // when it takes ownership after upgrade. A timeout on the underlying raw
  // TCP socket survives upgrade and would disconnect valid rooms after 8s.
  server.setTimeout(8000, (socket) => socket.destroy());
  const sockets = new Set();
  const attempts = new Map();
  server.on("connection", (socket) => {
    const ip = socket.remoteAddress;
    const now = Date.now();
    let entry = attempts.get(ip);
    if (!entry) {
      if (attempts.size >= 1024) return socket.destroy();
      entry = { since: now, count: 0, active: 0 };
      attempts.set(ip, entry);
    }
    if (now - entry.since >= 10000) {
      entry.since = now;
      entry.count = 0;
    }
    if (++entry.count > 30 || entry.active >= 12) return socket.destroy();
    entry.active++;
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => {
      entry.active--;
      sockets.delete(socket);
    });
  });
  const wss = new WebSocketServer({
    server,
    path: "/room",
    maxPayload: 196608,
    perMessageDeflate: false,
  });
  const peers = new Map();
  let closed = false;
  const send = (ws, payload) => {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 2 ** 20)
      ws.send(JSON.stringify({ seq: ++ws.outSeq, payload }));
  };
  const broadcast = (payload, except) => {
    for (const [id, p] of peers) if (id !== except) send(p.ws, payload);
  };
  wss.on("error", () => {});
  wss.on("connection", (ws) => {
    try {
      verifyTransport(ws._socket);
    } catch {
      return ws.terminate();
    }
    ws._socket.setTimeout(0);
    ws.outSeq = 0;
    ws.inSeq = 0;
    ws.alive = true;
    const timeout = setTimeout(() => ws.terminate(), 8000);
    let peer,
      count = 0,
      since = Date.now();
    ws.on("pong", () => {
      ws.alive = true;
    });
    ws.on("error", () => {});
    ws.on("message", (data, binary) => {
      try {
        if (Date.now() - since > 1000) {
          since = Date.now();
          count = 0;
        }
        if (++count > 120) return ws.terminate();
        if (binary) throw new Error("Text frame required");
        const envelope = JSON.parse(data);
        if (
          !Number.isSafeInteger(envelope.seq) ||
          envelope.seq !== ws.inSeq + 1
        )
          throw new Error("Replay");
        ws.inSeq = envelope.seq;
        const msg = envelope.payload;
        if (!peer) {
          if (msg.type !== "hello") throw new Error("Authentication failed");
          if (peers.size >= MAX_PEERS) {
            send(ws, {
              type: "error",
              message: "Комната заполнена: максимум 8 участников",
            });
            return ws.close(1008);
          }
          const nick =
            String(msg.name || "Участник")
              .replace(/[\x00-\x1f]/g, "")
              .trim()
              .slice(0, 32) || "Участник";
          peer = {
            id: crypto.randomUUID(),
            name: nick,
            color: Number.isInteger(msg.color) ? Math.abs(msg.color) % 6 : 0,
            ws,
          };
          clearTimeout(timeout);
          send(ws, {
            type: "welcome",
            self: peer.id,
            roomId,
            roomName: String(name).slice(0, 48),
            ...(iceServers ? { iceServers, connectionMode: "vps" } : {}),
            peers: [...peers.values()].map(({ ws, ...p }) => p),
          });
          peers.set(peer.id, peer);
          broadcast(
            {
              type: "peer-joined",
              peer: { id: peer.id, name: peer.name, color: peer.color },
            },
            peer.id,
          );
        } else if (
          msg.type === "signal" &&
          typeof msg.to === "string" &&
          JSON.stringify(msg.data).length < 131072
        ) {
          const target = peers.get(msg.to);
          if (target)
            send(target.ws, { type: "signal", from: peer.id, data: msg.data });
        }
      } catch {
        ws.terminate();
      }
    });
    ws.on("close", () => {
      clearTimeout(timeout);
      if (peer && peers.delete(peer.id))
        broadcast({ type: "peer-left", id: peer.id });
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, loopback ? "127.0.0.1" : "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });
  port = server.address().port;
  const heartbeat = setInterval(() => {
    for (const [ip, entry] of attempts)
      if (!entry.active && Date.now() - entry.since >= 10000)
        attempts.delete(ip);
    for (const ws of wss.clients) {
      if (!ws.alive) ws.terminate();
      else {
        ws.alive = false;
        ws.ping();
      }
    }
  }, 15000);
  const stun = dgram.createSocket("udp4");
  let stunReady = false,
    packets = 0;
  const stunLimit = setInterval(() => {
    packets = 0;
  }, 1000);
  stun.on("message", (message, info) => {
    if (++packets > 300) return;
    const response = bindingResponse(message, info.address, info.port);
    if (response) stun.send(response, info.port, info.address, () => {});
  });
  stun.on("error", () => {});
  await new Promise((resolve) => {
    stun.once("listening", () => {
      stunReady = true;
      resolve();
    });
    stun.once("error", resolve);
    if (loopback) resolve();
    else stun.bind(port, "0.0.0.0");
  });
  return {
    port,
    key: keyHex,
    roomId,
    addresses: localAddresses(),
    stunReady,
    setIceServers(value) {
      iceServers = value;
    },
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clearInterval(stunLimit);
      for (const ws of wss.clients) ws.terminate();
      for (const socket of sockets) socket.destroy();
      if (stunReady) stun.close();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve) => server.close(resolve));
      attempts.clear();
      key.fill(0);
    },
  };
}
class RoomClient extends EventEmitter {
  async connect(invite, profile) {
    const relayed =
      /^prestera:\/\/join\?/.test(invite) &&
      new URL(invite).searchParams.has("server");
    const tunnel = relayed ? await joinRelay(invite) : null;
    this.tunnel = tunnel;
    const {
      host = "localhost",
      port = 443,
      key: hex,
    } = tunnel || parseInvite(invite);
    const key = Buffer.from(hex, "hex");
    this.outSeq = 0;
    this.inSeq = 0;
    this.closed = false;
    this.ready = false;
    this.ws = new WebSocket(`wss://${host}:${port}/room`, {
      ...clientTlsOptions(key),
      agent: tunnel ? undefined : false,
      maxPayload: 196608,
      perMessageDeflate: false,
      handshakeTimeout: 8000,
      ...(tunnel
        ? {
            createConnection: () =>
              tls.connect({ ...clientTlsOptions(key), socket: tunnel.stream }),
          }
        : {}),
    });
    return await new Promise((resolve, reject) => {
      let joined = false;
      const timeout = setTimeout(() => {
        this.close();
        reject(
          new Error(
            "Не удалось войти. Проверь адрес, ключ комнаты и доступность порта.",
          ),
        );
      }, 12000);
      this.ws.on("error", (cause) => {
        clearTimeout(timeout);
        if (!joined)
          reject(
            new Error(
              "Защищённый вход отклонён или комната недоступна. Проверь приглашение, адрес и одинаковую версию приложения у всех.",
              { cause },
            ),
          );
      });
      this.ws.on("open", () => {
        try {
          verifyTransport(this.ws._socket, true);
          this.ready = true;
          this.send({
            type: "hello",
            name: String(profile.name).slice(0, 32),
            color: profile.color,
          });
        } catch {
          this.close();
        }
      });
      this.ws.on("message", (data, binary) => {
        try {
          if (!this.ready || binary)
            throw new Error("Secure text frame required");
          const envelope = JSON.parse(data);
          if (
            !Number.isSafeInteger(envelope.seq) ||
            envelope.seq !== this.inSeq + 1
          )
            throw new Error("Replay");
          this.inSeq = envelope.seq;
          const msg = envelope.payload;
          if (msg.type === "error") {
            clearTimeout(timeout);
            reject(new Error(msg.message));
            this.close();
          } else if (msg.type === "welcome" && !joined) {
            joined = true;
            clearTimeout(timeout);
            resolve({
              ...msg,
              iceServers: msg.iceServers || [{ urls: `stun:${host}:${port}` }],
            });
          } else if (joined) this.emit("event", msg);
          else throw new Error("Welcome required");
        } catch {
          this.close();
        }
      });
      this.ws.on("close", () => {
        tunnel?.ws.terminate();
        key.fill(0);
        this.ready = false;
        clearTimeout(timeout);
        if (!joined)
          reject(
            new Error(
              "Вход отклонён. Проверь приглашение: ключ мог измениться.",
            ),
          );
        if (!this.closed) this.emit("event", { type: "disconnected" });
      });
    });
  }
  send(payload) {
    if (this.ready && this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify({ seq: ++this.outSeq, payload }));
  }
  close() {
    this.closed = true;
    this.tunnel?.ws.terminate();
    if (this.ws) {
      this.ws.on("error", () => {});
      this.ws.close();
    }
  }
}
module.exports = {
  createRoom,
  RoomClient,
  parseInvite,
  inviteFor,
  localAddresses,
  bindingResponse,
};
