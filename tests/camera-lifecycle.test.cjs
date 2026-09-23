const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
function setup(getUserMedia) {
  const source = fs
    .readFileSync("src/engine.js", "utf8")
    .replace(/^import [\s\S]*?;\r?\n/gm, "")
    .replaceAll("export ", "");
  const bridge = {
    onWindowVideoEnded: () => () => {},
    onRoom: () => () => {},
    onAudioEnded: () => () => {},
    leave: async () => {},
  };
  const context = vm.createContext({
    window: { pibble: bridge },
    navigator: { mediaDevices: { getUserMedia } },
    EventAudio: class {
      play() {}
    },
    clearInterval,
    Map,
    Set,
    Promise,
  });
  const Engine = vm.runInContext(source + "\nClubEngine", context);
  const engine = new Engine(
    () => {},
    () => {},
    () => {},
  );
  engine.room = { self: "host" };
  engine.emit = () => {};
  engine.broadcastState = () => {};
  return engine;
}
function stream() {
  const track = {
    stopped: false,
    stop() {
      this.stopped = true;
    },
    onended: null,
  };
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
}
function pending() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
test("camera off releases hardware before a pending network replaceTrack finishes", async () => {
  const capture = stream(),
    engine = setup(async () => capture);
  await engine.toggleCamera();
  const wait = pending();
  engine.peers.set("guest", {
    transceivers: [null, { sender: { replaceTrack: () => wait.promise } }],
  });
  const stopping = engine.toggleCamera();
  assert.equal(capture.track.stopped, true);
  assert.equal(engine.cameraStream, null);
  assert.equal(engine.state.camera, false);
  wait.resolve();
  await stopping;
});
test("camera permission resolving after off cannot resurrect capture", async () => {
  const wait = pending(),
    capture = stream(),
    engine = setup(() => wait.promise);
  const starting = engine.toggleCamera();
  await engine.toggleCamera();
  wait.resolve(capture);
  await starting;
  assert.equal(capture.track.stopped, true);
  assert.equal(engine.cameraStream, null);
});
test("late camera request cannot overwrite a newer camera", async () => {
  const wait = pending(),
    old = stream(),
    current = stream();
  let call = 0;
  const engine = setup(() =>
    ++call === 1 ? wait.promise : Promise.resolve(current),
  );
  const starting = engine.toggleCamera();
  await engine.toggleCamera();
  await engine.toggleCamera();
  wait.resolve(old);
  await starting;
  assert.equal(old.track.stopped, true);
  assert.equal(current.track.stopped, false);
  assert.equal(engine.cameraStream, current);
  await engine.toggleCamera();
});
test("leaving the room invalidates an outstanding camera permission request", async () => {
  const wait = pending(),
    capture = stream(),
    engine = setup(() => wait.promise);
  engine.stopShare = async () => {};
  engine.stopSounds = () => {};
  engine.releaseMusic = () => {};
  const starting = engine.toggleCamera();
  await engine.leave();
  wait.resolve(capture);
  await starting;
  assert.equal(capture.track.stopped, true);
  assert.equal(engine.cameraStream, null);
});
test("failed camera permission permits retry", async () => {
  let call = 0;
  const capture = stream();
  const engine = setup(async () => {
    if (!call++) throw new Error("denied");
    return capture;
  });
  await assert.rejects(engine.toggleCamera(), /denied/);
  assert.equal(engine.cameraWanted, false);
  await engine.toggleCamera();
  assert.equal(engine.state.camera, true);
  await engine.toggleCamera();
});
