const { test } = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const tls = require("node:tls");
const { once } = require("node:events");
const { WebSocket } = require("ws");
const { createRoom, RoomClient, inviteFor } = require("../desktop/room.cjs");
const { clientTlsOptions } = require("../desktop/security.cjs");

function stayConnected(client, duration) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const disconnected = (event) => {
      if (event.type === "disconnected") {
        clearTimeout(timer);
        client.off("event", disconnected);
        reject(
          new Error(`Room disconnected after ${Date.now() - start} ms idle`),
        );
      }
    };
    const timer = setTimeout(() => {
      client.off("event", disconnected);
      if (client.ready) resolve();
      else reject(new Error("Client is no longer connected"));
    }, duration);
    client.on("event", disconnected);
  });
}

test(
  "A room stays open alone and with a guest across handshake and heartbeat deadlines",
  { timeout: 60000 },
  async (t) => {
    const room = await createRoom({ port: 46755, name: "Room lifetime" });
    const host = new RoomClient(),
      guest = new RoomClient();
    t.after(async () => {
      host.close();
      guest.close();
      await room.close();
    });
    const invitation = inviteFor("127.0.0.1", room.port, room.key);
    const hostWelcome = await host.connect(invitation, { name: "host" });
    await stayConnected(host, 17000);
    await guest.connect(invitation, { name: "guest" });
    await Promise.all([
      stayConnected(host, 32000),
      stayConnected(guest, 32000),
    ]);
    const routed = new Promise((resolve) =>
      host.on("event", (event) => {
        if (event.type === "signal") resolve(event);
      }),
    );
    guest.send({
      type: "signal",
      to: hostWelcome.self,
      data: { afterIdle: true },
    });
    assert.deepEqual((await routed).data, { afterIdle: true });
  },
);

test(
  "Unfinished TLS, HTTP and room hello still expire without admitting idle clients",
  { timeout: 14000 },
  async (t) => {
    const room = await createRoom({ port: 46756, name: "Pending deadlines" });
    const raw = net.connect(room.port, "127.0.0.1");
    const http = tls.connect({
      host: "127.0.0.1",
      port: room.port,
      ...clientTlsOptions(Buffer.from(room.key, "hex")),
    });
    const ws = new WebSocket(`wss://127.0.0.1:${room.port}/room`, {
      ...clientTlsOptions(Buffer.from(room.key, "hex")),
      agent: false,
    });
    t.after(async () => {
      raw.destroy();
      http.destroy();
      ws.terminate();
      await room.close();
    });
    const start = Date.now();
    const closures = [raw, http, ws].map((socket) => {
      socket.on("error", () => {});
      return new Promise((resolve) =>
        socket.once("close", () => resolve(Date.now() - start)),
      );
    });
    await once(http, "secureConnect");
    http.write("GET /room HTTP/1.1\r\nHost: localhost\r\n");
    await once(ws, "open");
    const elapsed = await Promise.all(closures);
    for (const ms of elapsed)
      assert.ok(
        ms >= 6000 && ms < 13000,
        `Expected pending deadline, got ${ms} ms`,
      );
  },
);
