const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function setup(nativeCapture) {
  const calls = [];
  const bridge = {
    onWindowVideoEnded: () => () => {},
    onRoom: () => () => {},
    onAudioEnded: () => () => {},
    selectSource: async () => calls.push("select"),
  };
  const source = fs
    .readFileSync("src/engine.js", "utf8")
    .replace(/^import [\s\S]*?;\r?\n/gm, "")
    .replaceAll("export ", "");
  const track = { stop() {}, getSettings: () => ({ width: 640, height: 360 }) };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const Engine = vm.runInNewContext(source + "\nClubEngine", {
    streamBitrate: vm.runInNewContext(
      fs.readFileSync("src/stream-quality.js", "utf8").replaceAll("export ", "") + "\nstreamBitrate",
    ),
    window: { pibble: bridge },
    EventAudio: class {
      play() {}
    },
    navigator: {
      mediaDevices: {
        getDisplayMedia: async () => {
          calls.push("chromium");
          return stream;
        },
      },
    },
    captureWindow: async (choice) => {
      calls.push(choice.backend);
      await nativeCapture(choice);
      return {
        stream,
        stop: async () => {},
        info: { backend: choice.backend },
      };
    },
  });
  const engine = new Engine(
    () => {},
    () => {},
    () => {},
  );
  engine.room = {};
  engine.settings = { nativeVideo: true, legacyWindowCapture: true };
  engine.audio = engine.replaceSlot = async () => {};
  engine.stopShare = async () => {
    ++engine.shareRequest;
  };
  engine.emit = engine.broadcastState = () => {};
  return { engine, calls };
}
const choice = { id: "window:123:0", audio: "none", mode: "borderless" };
test("empty GPU surface falls back only to borderless window capture", async () => {
  const { engine, calls } = setup(async ({ backend }) => {
    if (backend === "dwm") throw new Error("empty surface");
  });
  await engine.startShare(choice);
  assert.deepEqual(calls, ["select", "select", "dwm", "select", "gdi"]);
  assert.equal(engine.state.screen, true);
  assert.equal(engine.screenInfo.backend, "gdi");
});
test("borderless failure never silently starts Chromium capture", async () => {
  const { engine, calls } = setup(async () => {
    throw new Error("unsupported");
  });
  await assert.rejects(engine.startShare(choice), /unsupported/);
  assert.equal(calls.includes("chromium"), false);
  assert.equal(engine.shareStarting, false);
});
test("explicit compatible mode uses Chromium", async () => {
  const { engine, calls } = setup(async () => {
    throw new Error("unexpected native capture");
  });
  await engine.startShare({ ...choice, mode: "compatible" });
  assert.deepEqual(calls, ["select", "chromium"]);
});
