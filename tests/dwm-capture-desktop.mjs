import { _electron as electron } from "playwright";
import { spawn } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";
const fixture = spawn(path.resolve("native/bin/capture-fixture.exe"), [], {
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
fixture.stderr.on("data", (data) => process.stderr.write(data));
const env = {
  ...process.env,
  PIBBLE_TEST: "1",
  PIBBLE_DATA_DIR: path.resolve(`.cache/dwm-${Date.now()}`),
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  const hwnd = await new Promise((resolve, reject) => {
    fixture.once("error", reject);
    fixture.stdout.once("data", (data) => resolve(data.toString().trim()));
  });
  assert.match(hwnd, /^\d+$/);
  app = await electron.launch({ args: [process.cwd(), "--mute-audio"], env });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.pibble);
  const result = await page.evaluate(async (id) => {
    navigator.mediaDevices.getUserMedia =
      navigator.mediaDevices.getDisplayMedia = async () => {
        throw new Error("Device capture forbidden");
      };
    const generator = new MediaStreamTrackGenerator({ kind: "video" }),
      writer = generator.writable.getWriter(),
      token = crypto.randomUUID();
    let frames = 0;
    window.pibble.onGpuFrame(async (imported, received) => {
      if (received !== token) return;
      const frame = imported.getVideoFrame();
      try {
        await writer.write(frame);
        frames++;
      } finally {
        frame.close();
      }
    });
    const video = document.createElement("video");
    video.muted = true;
    video.autoplay = true;
    video.srcObject = new MediaStream([generator]);
    document.body.append(video);
    const choice = {
      id: `window:${id}:0`,
      audio: "none",
      backend: "dwm",
      width: 1280,
      height: 720,
      fps: 30,
      token,
    };
    await window.pibble.selectSource(choice);
    let info;
    try {
      info = await window.pibble.startWindowVideo(choice);
    } catch {
      await window.pibble.selectSource(choice);
      info = await window.pibble.startWindowVideo({
        ...choice,
        backend: "gdi",
      });
    }
    const end = performance.now() + 6000;
    while (frames < 20 && performance.now() < end)
      await new Promise((r) => setTimeout(r, 100));
    const dimensions = [video.videoWidth, video.videoHeight];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, 8, 8);
    const pixel = [...ctx.getImageData(4, 4, 1, 1).data];
    generator.stop();
    await writer.abort().catch(() => {});
    video.srcObject = null;
    await window.pibble.stopWindowVideo();
    return { info, frames, dimensions, pixel };
  }, hwnd);
  assert.ok(["DWM · GPU", "Окно · CPU → GPU"].includes(result.info.backend));
  assert.equal(result.info.borderless, true);
  assert.ok(result.frames >= 20, JSON.stringify(result));
  assert.deepEqual(result.dimensions, [80, 80]);
  [30, 90, 150].forEach((value, i) =>
    assert.ok(Math.abs(result.pixel[i] - value) <= 5, JSON.stringify(result)),
  );
  console.log(
    "Borderless capture → NT GPU texture → Electron → video track passed:",
    result,
  );
} finally {
  fixture.kill();
  await app?.close();
}
