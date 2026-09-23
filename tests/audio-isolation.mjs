import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
const executable = new URL("../native/bin/pibble-audio.exe", import.meta.url);
const processes = [];
function launch(args) {
  const child = spawn(fileURLToPath(executable), args, { windowsHide: true });
  processes.push(child);
  return child;
}
async function ready(child, prefix) {
  let text = "";
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.stderr.on("data", (data) => {
      text += data;
      if (text.includes(prefix)) resolve(text);
    });
    child.on("exit", (code) => {
      if (!text.includes(prefix))
        reject(new Error(`Native process failed: ${code} ${text}`));
    });
  });
}
function amplitude(samples, frequency) {
  let real = 0,
    imaginary = 0;
  const count = Math.min(samples.length / 4, 48000 * 2);
  const start = Math.max(0, Math.floor(samples.length / 4) - count);
  for (let i = 0; i < count; i++) {
    const sample = samples.readInt16LE((start + i) * 4) / 32768;
    const angle = (2 * Math.PI * frequency * i) / 48000;
    real += sample * Math.cos(angle);
    imaginary += sample * Math.sin(angle);
  }
  return (Math.sqrt(real ** 2 + imaginary ** 2) * 2) / count;
}
try {
  const target = launch(["--test-tone", "440"]);
  await ready(target, "TONE_READY");
  const other = launch(["--test-tone", "880"]);
  await ready(other, "TONE_READY");
  const capture = launch(["--pid", String(target.pid)]);
  const chunks = [];
  capture.stdout.on("data", (data) => chunks.push(data));
  await ready(capture, "READY");
  await new Promise((resolve) => setTimeout(resolve, 3500));
  capture.kill();
  await once(capture, "exit");
  const pcm = Buffer.concat(chunks),
    own = amplitude(pcm, 440),
    unrelated = amplitude(pcm, 880);
  const report = {
    bytes: pcm.length,
    target440Hz: own,
    other880Hz: unrelated,
    isolationDb: 20 * Math.log10(own / Math.max(unrelated, 1e-12)),
  };
  await fs.mkdir("test-results", { recursive: true });
  await fs.writeFile(
    "test-results/audio-isolation.json",
    JSON.stringify(report, null, 2),
  );
  console.log(report);
  assert.ok(own > 0.005, "Selected process audio must be present");
  assert.ok(
    report.isolationDb > 35,
    "Unrelated process must be at least 35 dB below selected process",
  );
  console.log("PASS: per-process audio isolation on this Windows build.");
} finally {
  for (const process of processes) process.kill();
}
