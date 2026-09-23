const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { once } = require("node:events");
const {
  createRoom,
  RoomClient,
  inviteFor,
  parseInvite,
  bindingResponse,
} = require("../desktop/room.cjs");
const eventOf = (client, type) =>
  new Promise((resolve) => {
    const listener = (event) => {
      if (event.type === type) {
        client.off("event", listener);
        resolve(event);
      }
    };
    client.on("event", listener);
  });

test("Invitations round-trip and reject malformed addresses, ports and keys", () => {
  const key = "a".repeat(64);
  assert.deepEqual(parseInvite(inviteFor("192.168.1.50", 45454, key)), {
    host: "192.168.1.50",
    port: 45454,
    key,
  });
  assert.equal(parseInvite(`my-pc:45454#${key}`).host, "my-pc");
  for (const value of [
    "http://evil.example",
    `localhost:0#${key}`,
    `localhost:99999#${key}`,
    "localhost:45454#bad",
    `pibble://join?host=localhost/path&port=45454&key=${key}`,
  ])
    assert.throws(() => parseInvite(value));
});
test("Embedded discovery encodes XOR-MAPPED-ADDRESS and ignores other UDP packets", () => {
  const request = Buffer.alloc(20);
  request.writeUInt16BE(1);
  request.writeUInt32BE(0x2112a442, 4);
  crypto.randomBytes(12).copy(request, 8);
  const response = bindingResponse(request, "203.0.113.5", 50123);
  assert.equal(response.readUInt16BE(0), 0x0101);
  assert.equal(response.readUInt16BE(26) ^ 0x2112, 50123);
  assert.deepEqual(
    [...response.subarray(28)].map((b, i) => b ^ request[4 + i]),
    [203, 0, 113, 5],
  );
  assert.deepEqual(response.subarray(8, 20), request.subarray(8, 20));
  assert.equal(
    bindingResponse(Buffer.from("not stun"), "127.0.0.1", 9999),
    null,
  );
});
test(
  "Room authenticates members, routes offers with server identity, enforces 8 peers, reports leave",
  { timeout: 15000 },
  async (t) => {
    const room = await createRoom({ port: 46721, name: "Тестовая стая" });
    const clients = [];
    t.after(async () => {
      clients.forEach((c) => c.close());
      await room.close();
    });
    const invite = inviteFor("127.0.0.1", room.port, room.key);
    const sessions = new Set();
    for (let i = 0; i < 8; i++) {
      const client = new RoomClient();
      clients.push(client);
      const welcome = await client.connect(invite, {
        name: `Пибл ${i}`,
        color: i,
      });
      assert.equal(welcome.peers.length, i);
      const tls = client.ws._socket;
      assert.equal(tls.authorized, true);
      assert.equal(tls.getProtocol(), "TLSv1.2");
      assert.equal(tls.getCipher().name, "ECDHE-PSK-CHACHA20-POLY1305");
      assert.equal(tls.getEphemeralKeyInfo().name, "X25519");
      assert.equal(tls.isSessionReused(), false);
      sessions.add(
        tls.exportKeyingMaterial(32, "pibble-test-only").toString("hex"),
      );
      client.self = welcome.self;
    }
    assert.equal(sessions.size, 8, "Every member has different session keys");
    const received = eventOf(clients[1], "signal");
    clients[0].send({
      type: "signal",
      from: "spoofed",
      to: clients[1].self,
      data: { description: { type: "offer", sdp: "test" } },
    });
    const event = await received;
    assert.equal(event.from, clients[0].self);
    assert.equal(event.data.description.sdp, "test");
    const ninth = new RoomClient();
    clients.push(ninth);
    await assert.rejects(
      ninth.connect(invite, { name: "Девятый" }),
      /8 участников/,
    );
    const wrong = new RoomClient();
    clients.push(wrong);
    await assert.rejects(
      wrong.connect(inviteFor("127.0.0.1", room.port, "0".repeat(64)), {
        name: "Wrong",
      }),
      /отклонён/,
    );
    const left = eventOf(clients[0], "peer-left");
    clients[7].close();
    assert.equal((await left).type, "peer-left");
  },
);
