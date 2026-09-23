// Source-only smoke check. Offscreen generated colors, no desktop/device capture.
import { _electron as electron } from "playwright";
import path from "node:path";
import assert from "node:assert/strict";
const env = {
  ...process.env,
  PIBBLE_TEST: "1",
  PIBBLE_DATA_DIR: path.resolve(`.cache/gpu-bridge-${Date.now()}`),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [process.cwd(), "--mute-audio"],
  env,
});
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.pibble);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia =
      navigator.mediaDevices.getDisplayMedia = async () => {
        throw new Error("Hardware capture forbidden");
      };
    window.receivedGpu = 0;
    const generator = new MediaStreamTrackGenerator({ kind: "video" });
    const writer = generator.writable.getWriter();
    const video = document.createElement("video");
    video.muted = true;
    video.autoplay = true;
    video.id = "gpu-test-video";
    video.srcObject = new MediaStream([generator]);
    document.body.append(video);
    window.pibble.onGpuFrame(async (imported, token) => {
      if (token !== "synthetic-test") return;
      const frame = imported.getVideoFrame();
      try {
        await writer.write(frame);
        window.receivedGpu++;
      } finally {
        frame.close();
      }
    });
  });
  await app.evaluate(async ({ BrowserWindow, sharedTexture }) => {
    const target = BrowserWindow.getAllWindows()[0].webContents;
    const source = new BrowserWindow({
      width: 320,
      height: 240,
      show: false,
      webPreferences: {
        offscreen: { useSharedTexture: true },
        backgroundThrottling: false,
        sandbox: true,
      },
    });
    globalThis.gpuSource = source;
    globalThis.gpuErrors = [];
    source.webContents.on("paint", (event) => {
      if (!event.texture) return;
      let imported;
      try {
        imported = sharedTexture.importSharedTexture({
          textureInfo: {
            ...event.texture.textureInfo,
            timestamp: Math.round(performance.now() * 1000),
          },
          allReferencesReleased: () => event.texture.release(),
        });
        sharedTexture
          .sendSharedTexture(
            { frame: target.mainFrame, importedSharedTexture: imported },
            "synthetic-test",
          )
          .catch((e) => globalThis.gpuErrors.push(e.message))
          .finally(() => imported.release());
      } catch (e) {
        globalThis.gpuErrors.push(e.message);
        event.texture.release();
      }
    });
    source.webContents.setFrameRate(10);
    await source.loadURL(
      "data:text/html,<body style='background:coral'><script>setInterval(()=>document.body.style.background=['coral','blue','green'][Math.floor(Math.random()*3)],100)</script>",
    );
  });
  await page.waitForFunction(
    () =>
      window.receivedGpu >= 3 &&
      document.querySelector("#gpu-test-video").videoWidth > 0,
    {},
    { timeout: 15000 },
  );
  assert.deepEqual(await app.evaluate(() => globalThis.gpuErrors), []);
  console.log(
    "GPU shared texture → sandboxed preload → VideoFrame → live video track: passed (generated colors only)",
  );
} finally {
  await app.close();
}
