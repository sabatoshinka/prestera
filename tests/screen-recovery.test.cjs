const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const { ScreenRecovery, screenParameters, refreshScreenSender, updateSender } =
  vm.runInNewContext(
    fs
      .readFileSync("src/screen-recovery.js", "utf8")
      .replaceAll("export ", "") +
      "\n({ScreenRecovery, screenParameters, refreshScreenSender, updateSender})",
  );
const sample = (now, changes = {}) => ({
  now,
  bitrate: 10_000_000,
  source: { width: 1920, height: 1080 },
  outbound: {
    width: 640,
    height: 360,
    fps: 30,
    kbps: 2000,
    limitation: "none",
    remoteLoss: 0,
  },
  network: { rtt: 30, availableOutgoingBitrate: 15_000_000 },
  ...changes,
});
test("screen recovery waits for sustained healthy bandwidth and enforces cooldown", () => {
  const recovery = new ScreenRecovery();
  assert.equal(recovery.shouldRecover(sample(0)), false);
  assert.equal(recovery.shouldRecover(sample(8000)), false);
  assert.equal(recovery.shouldRecover(sample(10000)), true);
  assert.equal(recovery.shouldRecover(sample(12000)), false);
  assert.equal(recovery.shouldRecover(sample(30000)), false);
  assert.equal(recovery.shouldRecover(sample(55000)), true);
});
test("loss, CPU pressure, insufficient or missing network statistics prevent recovery", () => {
  for (const changes of [
    { network: { rtt: 400, availableOutgoingBitrate: 15_000_000 } },
    { network: { rtt: 30, availableOutgoingBitrate: 3_000_000 } },
    { network: {} },
    { outbound: { ...sample(0).outbound, remoteLoss: 0.1 } },
    { outbound: { ...sample(0).outbound, limitation: "cpu" } },
    { outbound: { ...sample(0).outbound, limitation: "bandwidth" } },
  ]) {
    const recovery = new ScreenRecovery();
    recovery.shouldRecover(sample(0));
    assert.equal(recovery.shouldRecover(sample(10000, changes)), false);
    assert.equal(recovery.shouldRecover(sample(12000)), false);
  }
});

test("a high custom ceiling does not require that entire ceiling to recover, but actual traffic still needs headroom", () => {
  const recovery = new ScreenRecovery();
  const changes = { bitrate: 50_000_000, presetBitrate: 10_000_000 };
  assert.equal(recovery.shouldRecover(sample(0, changes)), false);
  assert.equal(recovery.shouldRecover(sample(10000, changes)), true);
  const busy = new ScreenRecovery();
  const active = { ...changes, outbound: { ...sample(0).outbound, kbps: 14000 } };
  assert.equal(busy.shouldRecover(sample(0, active)), false);
  assert.equal(busy.shouldRecover(sample(10000, active)), false);
});
test("static page and resized window do not cause repeated recovery", () => {
  const recovery = new ScreenRecovery();
  const changes = {
    source: { width: 640, height: 360 },
    outbound: { ...sample(0).outbound, fps: 1, inputFps: 1 },
  };
  assert.equal(recovery.shouldRecover(sample(0, changes)), false);
  assert.equal(recovery.shouldRecover(sample(60000, changes)), false);
});
test("screen policy preserves resolution without forcing a minimum bitrate", () => {
  const p = screenParameters(
    { encodings: [{ scaleResolutionDownBy: 4 }] },
    { bitrate: 6_000_000, fps: 30 },
  );
  assert.equal(p.degradationPreference, "maintain-resolution");
  assert.equal(p.encodings[0].scaleResolutionDownBy, 1);
  assert.equal(p.encodings[0].maxBitrate, 6_000_000);
  assert.equal(p.encodings[0].minBitrate, undefined);
});
test("sender refresh clears adaptation then restores policy, serialized with updates", async () => {
  let parameters = { encodings: [{}] },
    calls = [];
  const sender = {
    getParameters: () => structuredClone(parameters),
    async setParameters(value) {
      parameters = value;
      calls.push(value.degradationPreference);
    },
  };
  await Promise.all([
    refreshScreenSender(sender, { bitrate: 6_000_000, fps: 30 }),
    updateSender(sender, async () => {
      calls.push("next update");
    }),
  ]);
  assert.deepEqual(calls, ["balanced", "maintain-resolution", "next update"]);
  assert.equal(parameters.encodings[0].maxBitrate, 6_000_000);
  calls = [];
  assert.equal(await refreshScreenSender(sender, {}, () => false), false);
  assert.deepEqual(calls, []);
});
test("failed refresh still attempts to restore resolution policy", async () => {
  const calls = [];
  const sender = {
    getParameters: () => ({ encodings: [{}] }),
    async setParameters(p) {
      calls.push(p.degradationPreference);
      if (calls.length === 1) throw new Error("temporary failure");
    },
  };
  await assert.rejects(refreshScreenSender(sender, {}), /temporary failure/);
  assert.deepEqual(calls, ["balanced", "maintain-resolution"]);
});

test("engine statistics trigger a bounded sender refresh without restarting capture", async () => {
  let now = 0,
    parameters = { encodings: [{}] };
  const calls = [],
    track = { getSettings: () => ({ width: 1920, height: 1080 }) };
  const peer = {
    id: "guest",
    pc: {
      connectionState: "connected",
      getStats: async () =>
        new Map([
          [
            "pair",
            {
              type: "candidate-pair",
              state: "succeeded",
              nominated: true,
              currentRoundTripTime: 0.03,
              availableOutgoingBitrate: 15_000_000,
            },
          ],
        ]),
    },
    transceivers: [
      null,
      null,
      {
        sender: {
          track,
          getParameters: () => structuredClone(parameters),
          setParameters: async (p) => {
            parameters = p;
            calls.push(p.degradationPreference);
          },
          getStats: async () =>
            new Map([
              [
                "out",
                {
                  id: "out",
                  type: "outbound-rtp",
                  kind: "video",
                  timestamp: now + 1000,
                  bytesSent: 1000 + now * 250,
                  framesEncoded: (now / 1000) * 30,
                  framesPerSecond: 30,
                  frameWidth: 640,
                  frameHeight: 360,
                  qualityLimitationReason: "none",
                  remoteId: "remote",
                },
              ],
              ["remote", { type: "remote-inbound-rtp", fractionLost: 0 }],
            ]),
        },
        receiver: { getStats: async () => new Map() },
      },
    ],
  };
  const stats = vm.runInNewContext(
    fs.readFileSync("src/stream-stats.js", "utf8").replaceAll("export ", "") +
      "\nvideoStats",
  );
  const Engine = vm.runInNewContext(
    fs
      .readFileSync("src/engine.js", "utf8")
      .replace(/^import [\s\S]*?;\r?\n/gm, "")
      .replaceAll("export ", "") + "\nClubEngine",
    {
      ScreenRecovery,
      screenParameters,
      refreshScreenSender,
      updateSender,
      videoStats: stats,
      performance: { now: () => now },
      EventAudio: class {},
      window: {
        pibble: {
          onWindowVideoEnded: () => {},
          onRoom: () => {},
          onAudioEnded: () => {},
        },
      },
    },
  );
  const engine = new Engine(
    () => {},
    () => {},
    () => {},
  );
  engine.emit = () => {};
  engine.peers.set(peer.id, peer);
  engine.state.screen = true;
  engine.screenStream = { getVideoTracks: () => [track] };
  engine.shareQuality = { bitrate: 10_000_000, fps: 60 };
  for (now = 0; now <= 14000; now += 2000) await engine.collectStats();
  assert.deepEqual(calls, ["balanced", "maintain-resolution"]);
  assert.equal(peer.stats.sendingScreen.recoveries, 1);
  assert.equal(engine.screenStream.getVideoTracks()[0], track);
});
