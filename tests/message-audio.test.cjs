const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
test("message notifications respect settings, output volume and burst limit", async () => {
  let now = 0;
  const played = [];
  const Audio = class {
    constructor(url) {
      this.url = url;
    }
    async setSinkId(sink) {
      this.sink = sink;
    }
    async play() {
      played.push(this);
    }
    pause() {}
  };
  const Type = vm.runInNewContext(
    fs
      .readFileSync("src/event-audio.js", "utf8")
      .replace("export class", "class") + "\nEventAudio",
    { Audio, performance: { now: () => now } },
  );
  const events = new Type(),
    settings = {
      eventSounds: true,
      messageSounds: true,
      eventGain: 25,
      output: "test-speakers",
    };
  await events.play("message", { ...settings, messageSounds: false });
  await events.play("message", { ...settings, eventSounds: false });
  assert.equal(played.length, 0);
  await events.play("message", settings);
  await events.play("message", settings);
  assert.equal(played.length, 1);
  assert.equal(played[0].volume, 0.25);
  assert.equal(played[0].sink, "test-speakers");
  now = 800;
  await events.play("message", settings);
  assert.equal(played.length, 2);
});
