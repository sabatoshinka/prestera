// An outer WSS tunnel carries the existing end-to-end TLS-PSK room transport.
// The broker never receives the room PSK or plaintext SDP/profile messages.
const { WebSocket, createWebSocketStream } = require("ws");
const crypto = require("node:crypto");
const net = require("node:net");
function relayUrl(value) {
  const u = new URL(String(value));
  if (u.protocol === "https:") u.protocol = "wss:";
  if (
    u.protocol !== "wss:" &&
    !(
      process.env.PIBBLE_TEST &&
      u.protocol === "ws:" &&
      ["127.0.0.1", "localhost"].includes(u.hostname)
    )
  )
    throw new Error("Адрес VPS должен начинаться с https:// или wss://");
  if (
    u.username ||
    u.password ||
    u.hash ||
    u.search ||
    !["", "/", "/relay"].includes(u.pathname)
  )
    throw new Error("Укажи адрес сервера без параметров");
  u.pathname = "/relay";
  return u.href;
}
function accessToken(key) {
  return crypto
    .createHmac("sha256", Buffer.from(key, "hex"))
    .update("prestera-relay-access-v1")
    .digest("hex");
}
function relayInvite(server, room, key) {
  return `prestera://join?server=${encodeURIComponent(relayUrl(server))}&room=${room}#${key}`;
}
function parseRelayInvite(value) {
  const u = new URL(value),
    room = u.searchParams.get("room"),
    key = u.hash.slice(1);
  if (
    u.protocol !== "prestera:" ||
    u.hostname !== "join" ||
    !/^[a-f0-9]{32}$/.test(room || "") ||
    !/^[a-f0-9]{64}$/.test(key)
  )
    throw new Error("Некорректное приглашение VPS");
  return { server: relayUrl(u.searchParams.get("server")), room, key };
}
function openRelay(server, hello, tunnel = false) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(relayUrl(server), {
      handshakeTimeout: 10000,
      maxPayload: 262144,
      perMessageDeflate: false,
    });
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("VPS не ответил вовремя"));
    }, 15000);
    const fail = () => {
      clearTimeout(timer);
      reject(new Error("VPS недоступен, ключ неверен или комната закрыта"));
    };
    ws.on("error", fail);
    ws.once("close", fail);
    ws.once("open", () => ws.send(JSON.stringify(hello)));
    const message = (bytes, binary) => {
      try {
        if (binary) throw new Error();
        const msg = JSON.parse(bytes);
        if (msg.type !== "ready") throw new Error(msg.message);
        clearTimeout(timer);
        ws.off("message", message);
        ws.off("close", fail);
        const stream = tunnel ? createWebSocketStream(ws) : null;
        stream?.on("error", () => {});
        resolve({ ws, stream, ...msg });
      } catch {
        ws.terminate();
        fail();
      }
    };
    ws.on("message", message);
  });
}
async function publishRoom(server, room, key, port, serverKey) {
  const control = await openRelay(server, {
    type: "host",
    room,
    token: accessToken(key),
    serverKey,
  });
  const tunnels = new Set();
  let closed = false,
    opening = 0;
  control.ws.on("message", async (bytes) => {
    let reserved = false;
    try {
      const msg = JSON.parse(bytes);
      if (msg.type !== "connect" || !/^[a-f0-9]{48}$/.test(msg.ticket)) return;
      if (closed || tunnels.size + opening >= 7) return;
      opening++;
      reserved = true;
      const { ws, stream } = await openRelay(
        server,
        { type: "attach", ticket: msg.ticket, room, token: accessToken(key) },
        true,
      );
      if (closed) return ws.terminate();
      tunnels.add(ws);
      const socket = net.connect({ host: "127.0.0.1", port });
      const stop = () => {
        socket.destroy();
        stream.destroy();
        tunnels.delete(ws);
      };
      socket.on("error", stop);
      socket.on("close", stop);
      ws.on("close", stop);
      stream.pipe(socket).pipe(stream);
    } catch {
      /* Individual failures leave the room available for a retry. */
    } finally {
      if (reserved) opening--;
    }
  });
  return {
    ...control,
    close() {
      closed = true;
      control.ws.terminate();
      for (const ws of tunnels) ws.terminate();
      tunnels.clear();
    },
  };
}
async function joinRelay(invite) {
  const config = parseRelayInvite(invite);
  return {
    ...config,
    ...(await openRelay(
      config.server,
      { type: "join", room: config.room, token: accessToken(config.key) },
      true,
    )),
  };
}
module.exports = {
  relayUrl,
  accessToken,
  relayInvite,
  parseRelayInvite,
  publishRoom,
  joinRelay,
};
