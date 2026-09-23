const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const videoStats = vm.runInNewContext(
  fs
    .readFileSync("src/stream-stats.js", "utf8")
    .replace("export function", "function") + "\nvideoStats",
);
const reports = (value) => new Map([[value.id, value]]);
test("video statistics use interval rates and retain independent camera/screen baselines", () => {
  const samples = new Map();
  const screen = {
    id: "screen",
    kind: "video",
    type: "outbound-rtp",
    timestamp: 1000,
    bytesSent: 10000,
    framesEncoded: 10,
    totalEncodeTime: 0.1,
  };
  assert.equal(videoStats(reports(screen), samples).kbps, undefined);
  videoStats(reports({ ...screen, id: "camera", bytesSent: 900000 }), samples);
  const stats = videoStats(
    reports({
      ...screen,
      timestamp: 3000,
      bytesSent: 1010000,
      framesEncoded: 130,
      totalEncodeTime: 0.7,
      qualityLimitationReason: "cpu",
    }),
    samples,
  );
  assert.equal(stats.kbps, 4000);
  assert.equal(stats.fps, 60);
  assert.equal(stats.encodeMs, 5);
  assert.equal(stats.limitation, "cpu");
});
test("receiver jitter buffer delay is per emitted frame in the current interval", () => {
  const samples = new Map();
  const first = {
    id: "screen",
    kind: "video",
    type: "inbound-rtp",
    timestamp: 1000,
    jitterBufferDelay: 50,
    jitterBufferEmittedCount: 100,
    framesDropped: 5,
    packetsLost: 7,
  };
  videoStats(reports(first), samples);
  const stats = videoStats(
    reports({
      ...first,
      timestamp: 3000,
      jitterBufferDelay: 56,
      jitterBufferEmittedCount: 220,
      framesDropped: 8,
      packetsLost: 9,
    }),
    samples,
  );
  assert.equal(stats.bufferMs, 50);
  assert.equal(stats.dropped, 3);
  assert.equal(stats.lost, 2);
});
