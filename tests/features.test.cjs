const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

test("Sound trimming exports exactly the selected PCM samples and rejects invalid cuts", async () => {
  const { trimToWav } = await import("../src/media-utils.js");
  const samples = Float32Array.from({ length: 40000 }, (_, i) => i / 40000);
  const buffer = { duration: 40, length: 40000, sampleRate: 1000, numberOfChannels: 1, getChannelData: () => samples };
  const result = await trimToWav(buffer, 5, 8).arrayBuffer(), view = new DataView(result);
  assert.equal(result.byteLength, 44 + 3000 * 2);
  assert.equal(view.getUint32(24, true), 1000);
  assert.equal(view.getInt16(44, true), Math.round(samples[5000] * 32767));
  assert.equal(view.getInt16(result.byteLength - 2, true), Math.round(samples[7999] * 32767));
  for (const [start, end] of [[-1, 2], [4, 2], [0, 31], [39, 42], [NaN, 3]]) assert.throws(() => trimToWav(buffer, start, end));
});

test("Avatar and Spotify inputs only accept bounded images and canonical Spotify links", async () => {
  const { safeAvatar, spotifyUrl } = await import("../src/media-utils.js");
  assert.equal(safeAvatar("data:image/webp;base64,YQ=="), "data:image/webp;base64,YQ==");
  for (const value of ["https://external.example/track.png", "data:image/svg+xml;base64,YQ==", "data:image/webp;base64," + "a".repeat(48000)]) assert.equal(safeAvatar(value), "");
  assert.equal(spotifyUrl("https://open.spotify.com/intl-ru/playlist/37i9dQZF1DXcBWIGoYBM5M?si=test").embed, "https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M?theme=0");
  for (const value of ["http://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", "https://open.spotify.com.evil/playlist/37i9dQZF1DXcBWIGoYBM5M", "https://user@open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", "javascript:alert(1)"]) assert.equal(spotifyUrl(value), null);
});

function voiceGate(options) {
  let Processor;
  vm.runInNewContext(fs.readFileSync("public/voice-gate-worklet.js", "utf8"), {
    sampleRate: 48000,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: value => { this.meter = value; } }; } },
    registerProcessor: (_name, type) => { Processor = type; },
  });
  const gate = new Processor();
  gate.port.onmessage({ data: options });
  return gate;
}
function pass(gate, amplitude, blocks) {
  let output;
  for (let block = 0; block < blocks; block++) {
    const input = Float32Array.from({ length: 128 }, (_, i) => amplitude * Math.sin((block * 128 + i) / 48000 * Math.PI * 2 * 1000));
    output = new Float32Array(128);
    gate.process([[input]], [[output]]);
  }
  return Math.sqrt(output.reduce((sum, value) => sum + value * value, 0) / output.length);
}
test("Microphone gate passes speech, holds short pauses and suppresses quiet background", () => {
  const gate = voiceGate({ enabled: true, threshold: -40, hold: 250 });
  assert.ok(pass(gate, 0.1, 120) > 0.06);
  assert.ok(pass(gate, 0.0001, 20) > 0.00006, "Short pauses should not close the gate");
  assert.ok(pass(gate, 0.0001, 350) < 0.000001, "Quiet signal should close after hold/release");
  assert.ok(pass(gate, 0.1, 120) > 0.06, "Speech reopens the gate");
});
test("Disabling the microphone gate preserves quiet audio", () => {
  const gate = voiceGate({ enabled: false, threshold: -10, hold: 50 });
  assert.ok(pass(gate, 0.0001, 120) > 0.00006);
});
