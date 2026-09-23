const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const net = require("node:net");
const tls = require("node:tls");
const { once } = require("node:events");
const { WebSocket, WebSocketServer } = require("ws");
const { createRoom, RoomClient, inviteFor } = require("../desktop/room.cjs");
const { clientTlsOptions, PSK_IDENTITY } = require("../desktop/security.cjs");

let port = 46730;
const options = { timeout: 10000 };
async function setup(t) {
  const room = await createRoom({ port: port++, name: "PRIVATE_ROOM_MARKER" });
  t.after(() => room.close());
  return room;
}
async function member(
  t,
  room,
  name = "PRIVATE_NAME_MARKER",
  addressPort = room.port,
) {
  const client = new RoomClient();
  t.after(() => client.close());
  const welcome = await client.connect(
    inviteFor("127.0.0.1", addressPort, room.key),
    { name },
  );
  client.self = welcome.self;
  return client;
}
function closed(socket) {
  return new Promise((resolve) => socket.once("close", resolve));
}
function deadline(promise, ms = 2000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Expected rejection/closure did not occur")),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}
function tlsConnect(t, room, overrides = {}) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: "127.0.0.1",
      port: room.port,
      ...clientTlsOptions(Buffer.from(room.key, "hex")),
      ...overrides,
    });
    t.after(() => socket.destroy());
    socket.once("secureConnect", () => resolve(socket));
    socket.on("error", reject);
  });
}
async function rawWebSocket(t, room) {
  const ws = new WebSocket(`wss://127.0.0.1:${room.port}/room`, {
    ...clientTlsOptions(Buffer.from(room.key, "hex")),
    agent: false,
  });
  t.after(() => ws.terminate());
  ws.on("error", () => {});
  await once(ws, "open");
  return ws;
}

// A real TCP intermediary. It has no room key and can only see TLS records.
async function relay(t, targetPort) {
  const sockets = new Set();
  const trace = [];
  const control = { attack: null, attacked: false, clientRecords: [] };
  const server = net.createServer((downstream) => {
    const upstream = net.connect(targetPort, "127.0.0.1");
    for (const socket of [upstream, downstream]) {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.on("close", () => {
        sockets.delete(socket);
        upstream.destroy();
        downstream.destroy();
      });
    }
    let pending = Buffer.alloc(0);
    downstream.on("data", (chunk) => {
      trace.push(Buffer.from(chunk));
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 5) {
        const size = 5 + pending.readUInt16BE(3);
        if (pending.length < size) break;
        const record = Buffer.from(pending.subarray(0, size));
        pending = pending.subarray(size);
        control.clientRecords.push(Buffer.from(record));
        if (control.attack && record[0] === 23 && !control.attacked) {
          control.attacked = true;
          if (control.attack === "tamper") record[record.length - 1] ^= 1;
          upstream.write(record);
          if (control.attack === "replay") upstream.write(record);
        } else upstream.write(record);
      }
    });
    upstream.on("data", (chunk) => {
      trace.push(Buffer.from(chunk));
      downstream.write(chunk);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  return { port: server.address().port, trace, control };
}

test(
  "Port scanners and clients with missing/wrong secrets cannot join",
  options,
  async (t) => {
    const room = await setup(t);
    const observer = await member(t, room);
    const events = [];
    observer.on("event", (e) => events.push(e));
    const plain = new WebSocket(`ws://127.0.0.1:${room.port}/room`);
    t.after(() => plain.terminate());
    plain.on("error", () => {});
    let opened = false;
    plain.on("open", () => {
      opened = true;
    });
    await deadline(closed(plain));
    assert.equal(opened, false);
    await assert.rejects(tlsConnect(t, room, { pskCallback: undefined }));
    await assert.rejects(
      tlsConnect(t, room, {
        pskCallback: () => ({
          identity: PSK_IDENTITY,
          psk: crypto.randomBytes(32),
        }),
      }),
    );
    await assert.rejects(
      tlsConnect(t, room, {
        pskCallback: () => ({
          identity: "another-protocol",
          psk: Buffer.from(room.key, "hex"),
        }),
      }),
    );
    assert.equal(events.filter((e) => e.type === "peer-joined").length, 0);
    const valid = await member(t, room, "valid");
    assert.equal(valid.ws._socket.authorized, true);
  },
);

test(
  "Clients reject a fake host without the invitation secret and reject legacy plaintext",
  options,
  async (t) => {
    const room = await setup(t);
    const wrong = new RoomClient();
    t.after(() => wrong.close());
    await assert.rejects(
      wrong.connect(inviteFor("127.0.0.1", room.port, "1".repeat(64)), {
        name: "secret name",
      }),
    );
    const legacy = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await once(legacy, "listening");
    t.after(() => new Promise((resolve) => legacy.close(resolve)));
    const client = new RoomClient();
    t.after(() => client.close());
    await assert.rejects(
      client.connect(inviteFor("127.0.0.1", legacy.address().port, room.key), {
        name: "secret name",
      }),
    );
  },
);

test(
  "TLS refuses other protocol versions, non-ECDHE ciphers and other curves",
  options,
  async (t) => {
    const room = await setup(t);
    await assert.rejects(
      tlsConnect(t, room, { minVersion: "TLSv1.3", maxVersion: "TLSv1.3" }),
    );
    await assert.rejects(
      tlsConnect(t, room, { ciphers: "PSK-AES128-CBC-SHA" }),
    );
    await assert.rejects(tlsConnect(t, room, { ecdhCurve: "prime256v1" }));
  },
);

test(
  "Reconnect performs fresh X25519 even when a saved TLS session is offered",
  options,
  async (t) => {
    const room = await setup(t);
    const first = await tlsConnect(t, room);
    const session = first.getSession();
    assert.ok(session?.length);
    const key1 = first.exportKeyingMaterial(32, "pibble-test-only");
    first.destroy();
    const next = await tlsConnect(t, room, { session });
    assert.equal(next.isSessionReused(), false);
    assert.equal(next.getEphemeralKeyInfo().name, "X25519");
    assert.notDeepEqual(
      next.exportKeyingMaterial(32, "pibble-test-only"),
      key1,
    );
  },
);

test(
  "A TCP observer cannot read invitations, names or SDP; recorded login cannot be reused",
  options,
  async (t) => {
    const room = await setup(t);
    const observer = await member(t, room, "observer");
    let joins = 0;
    observer.on("event", (e) => {
      if (e.type === "peer-joined") joins++;
    });
    const proxy = await relay(t, room.port);
    const sender = await member(t, room, "PRIVATE_NAME_MARKER", proxy.port);
    const signal = once(observer, "event");
    sender.send({
      type: "signal",
      to: observer.self,
      data: { sdp: "PRIVATE_SDP_MARKER" },
    });
    let [event] = await signal;
    if (event.type !== "signal") [event] = await once(observer, "event");
    assert.equal(event.data.sdp, "PRIVATE_SDP_MARKER");
    const wire = Buffer.concat(proxy.trace);
    for (const text of [
      room.key,
      "PRIVATE_NAME_MARKER",
      "PRIVATE_ROOM_MARKER",
      "PRIVATE_SDP_MARKER",
      "GET /room",
    ])
      assert.equal(wire.includes(Buffer.from(text)), false, text + " leaked");
    assert.equal(wire.includes(Buffer.from(room.key, "hex")), false);
    const recorded = Buffer.concat(proxy.control.clientRecords);
    const socket = net.connect(room.port, "127.0.0.1");
    t.after(() => socket.destroy());
    socket.on("error", () => {});
    socket.resume();
    const done = closed(socket);
    socket.end(recorded);
    await deadline(done);
    assert.equal(joins, 1, "A recorded login must not create a new member");
  },
);

for (const attack of ["tamper", "replay"]) {
  test(
    `TLS rejects ${attack} of a live encrypted signaling record`,
    options,
    async (t) => {
      const room = await setup(t);
      const receiver = await member(t, room, "receiver");
      const proxy = await relay(t, room.port);
      const sender = await member(t, room, "sender", proxy.port);
      const signals = [];
      receiver.on("event", (e) => {
        if (e.type === "signal") signals.push(e);
      });
      proxy.control.attack = attack;
      const disconnected = closed(sender.ws);
      sender.send({
        type: "signal",
        to: receiver.self,
        data: { text: "once-only" },
      });
      await deadline(disconnected);
      // The receiver processes routed data before the server's subsequent peer-left.
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(proxy.control.attacked, true);
      assert.equal(signals.length, attack === "replay" ? 1 : 0);
    },
  );
}

test(
  "Malformed and repeated application messages are rejected after TLS authentication",
  options,
  async (t) => {
    const room = await setup(t);
    for (const data of [
      "not-json",
      JSON.stringify({
        seq: 1,
        payload: { type: "signal", to: "x", data: {} },
      }),
    ]) {
      const ws = await rawWebSocket(t, room);
      const done = closed(ws);
      ws.send(data);
      await deadline(done);
    }
    const ws = await rawWebSocket(t, room);
    const hello = JSON.stringify({
      seq: 1,
      payload: { type: "hello", name: "member" },
    });
    const welcome = once(ws, "message");
    ws.send(hello);
    await welcome;
    const done = closed(ws);
    ws.send(hello);
    await deadline(done);
  },
);

test(
  "Pending connections per IP are bounded and closing the room releases them",
  options,
  async (t) => {
    const room = await setup(t);
    const pending = [];
    for (let i = 0; i < 12; i++) {
      const socket = net.connect(room.port, "127.0.0.1");
      t.after(() => socket.destroy());
      socket.on("error", () => {});
      pending.push(socket);
      await once(socket, "connect");
    }
    const excess = net.connect(room.port, "127.0.0.1");
    t.after(() => excess.destroy());
    excess.on("error", () => {});
    await deadline(closed(excess));
    const allClosed = Promise.all(pending.map(closed));
    await room.close();
    await deadline(allClosed);
  },
);
