const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const streamBitrate = vm.runInNewContext(
  fs.readFileSync("src/stream-quality.js", "utf8").replaceAll("export ", "") +
    "\nstreamBitrate",
);
const { screenParameters, updateSender } = vm.runInNewContext(
  fs.readFileSync("src/screen-recovery.js", "utf8").replaceAll("export ", "") +
    "\n({screenParameters, updateSender})",
);
test("bitrate presets are preserved and custom Mbps values are bounded and converted to bits/s", () => {
  assert.equal(streamBitrate(0, 3000000), 3000000);
  assert.equal(streamBitrate(undefined, 6000000), 6000000);
  assert.equal(streamBitrate(Infinity), 10000000);
  assert.equal(streamBitrate(25), 25000000);
  assert.equal(streamBitrate(1000), 50000000);
  assert.equal(streamBitrate(0.1), 1000000);
});
test("changing the live cap updates every screen sender, preserving resolution, FPS and other media limits", async () => {
  const Engine = vm.runInNewContext(
    fs
      .readFileSync("src/engine.js", "utf8")
      .replace(/^import [\s\S]*?;\r?\n/gm, "")
      .replaceAll("export ", "") + "\nClubEngine",
    {
      streamBitrate,
      screenParameters,
      updateSender,
      profileData: () => ({}),
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
  engine.sharePresetBitrate = 5000000;
  engine.shareQuality = { bitrate: 5000000, width: 1280, height: 720, fps: 60 };
  const sent = [];
  for (let i = 0; i < 2; i++) {
    const parameters = Array.from({ length: 5 }, () => ({ encodings: [{}] }));
    engine.peers.set(String(i), {
      pc: { connectionState: "connected" },
      transceivers: parameters.map((p, index) => ({
        sender: {
          getParameters: () => structuredClone(p),
          setParameters: async (next) => {
            parameters[index] = next;
          },
        },
      })),
    });
    sent.push(parameters);
  }
  await engine.applySettings({ streamMbps: 30 });
  for (const p of sent) {
    assert.equal(p[2].encodings[0].maxBitrate, 30000000);
    assert.equal(p[2].encodings[0].maxFramerate, 60);
    assert.equal(p[2].encodings[0].scaleResolutionDownBy, 1);
    assert.equal(p[0].encodings[0].maxBitrate, 96000);
    assert.equal(p[1].encodings[0].maxBitrate, 2500000);
  }
  await engine.applySettings({ streamMbps: 0 });
  assert.equal(engine.shareQuality.bitrate, 5000000);
  for (const p of sent) assert.equal(p[2].encodings[0].maxBitrate, 5000000);
});
