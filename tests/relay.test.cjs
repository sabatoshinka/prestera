const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { once } = require("node:events");
const { createBroker, iceServers } = require("../server/broker.cjs");
const { createRoom, RoomClient, inviteFor } = require("../desktop/room.cjs");
const {
  publishRoom,
  relayInvite,
  parseRelayInvite,
  accessToken,
  relayUrl,
} = require("../desktop/relay.cjs");
process.env.PIBBLE_TEST = "1";
test(
  "VPS tunnels preserve authenticated ECDHE signaling, membership, TURN settings and host shutdown",
  { timeout: 20000 },
  async () => {
    const serverKey = crypto.randomBytes(32).toString("hex");
    const broker = createBroker({
      serverKey,
      turnHost: "turn.example.org",
      turnSecret: "test-only-secret",
    });
    await new Promise((r) => broker.server.listen(0, "127.0.0.1", r));
    const server = `ws://127.0.0.1:${broker.server.address().port}`;
    const host = await createRoom({
      port: 0,
      loopback: true,
      name: "Private room",
    });
    const room = crypto.randomBytes(16).toString("hex");
    let published;
    const clients = [];
    try {
      await assert.rejects(
        publishRoom(server, room, host.key, host.port, "wrong-key"),
      );
      published = await publishRoom(
        server,
        room,
        host.key,
        host.port,
        serverKey,
      );
      host.setIceServers(published.iceServers);
      const owner = new RoomClient();
      clients.push(owner);
      const joiningOwner = owner.connect(
        inviteFor("127.0.0.1", host.port, host.key),
        { name: "Owner", color: 0 },
      );
      const ownerInfo = await joiningOwner;
      const invitation = relayInvite(server, room, host.key);
      const guest = new RoomClient();
      clients.push(guest);
      const guestInfo = await guest.connect(invitation, {
        name: "Guest",
        color: 1,
      });
      assert.equal(guestInfo.connectionMode, "vps");
      assert.equal(
        guestInfo.iceServers[1].urls[0],
        "turn:turn.example.org:3478?transport=udp",
      );
      assert.equal(guestInfo.peers[0].id, ownerInfo.self);
      assert.equal(
        guest.ws._socket.getCipher().name,
        "ECDHE-PSK-CHACHA20-POLY1305",
      );
      assert.equal(guest.ws._socket.getEphemeralKeyInfo().name, "X25519");
      await new Promise((resolve) => setTimeout(resolve, 8500));
      assert.equal(
        guest.ws.readyState,
        1,
        "TLS inside the tunnel must remain open after handshake timeout",
      );
      const event = once(owner, "event");
      guest.send({
        type: "signal",
        to: ownerInfo.self,
        data: { description: "private SDP" },
      });
      const [signal] = await event;
      assert.equal(signal.data.description, "private SDP");
      assert.equal(signal.from, guestInfo.self);
      const bad = new RoomClient();
      clients.push(bad);
      await assert.rejects(
        bad.connect(relayInvite(server, room, "aa".repeat(32)), {
          name: "Intruder",
        }),
      );
      assert.notEqual(broker.rooms.get(room).token, host.key);
      const disconnected = once(guest, "event");
      published.close();
      assert.equal((await disconnected)[0].type, "disconnected");
    } finally {
      for (const c of clients) c.close();
      published?.close();
      await host.close();
      await broker.close();
    }
  },
);
test("VPS invitations reject insecure remote URLs; TURN credential is time-limited HMAC", () => {
  assert.throws(() => relayUrl("http://example.org"));
  assert.throws(() => relayUrl("wss://user:password@example.org"));
  const url = relayInvite(
    "https://example.org",
    "ab".repeat(16),
    "cd".repeat(32),
  );
  assert.equal(parseRelayInvite(url).key, "cd".repeat(32));
  assert.equal(new URL(url).searchParams.has("key"), false);
  const turn = iceServers(
    { turnHost: "example.org", turnSecret: "secret" },
    "room",
  )[1];
  assert.equal(
    turn.credential,
    crypto.createHmac("sha1", "secret").update(turn.username).digest("base64"),
  );
  assert.ok(+turn.username.split(":")[0] > Date.now() / 1000);
});
