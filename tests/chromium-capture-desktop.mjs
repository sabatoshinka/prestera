import { _electron as electron } from "playwright";
import path from "node:path";
import assert from "node:assert/strict";
const env = {
  ...process.env,
  PIBBLE_TEST: "1",
  PIBBLE_DATA_DIR: path.resolve(`.cache/dwm-${Date.now()}`),
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ args: [process.cwd(), "--mute-audio"], env });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.pibble);
  const hwnd = await app.evaluate(async ({ BrowserWindow }) => {
    const source = new BrowserWindow({
      width: 320,
      height: 240,
      frame: false,
      show: false,
      skipTaskbar: true,
      focusable: false,
      webPreferences: { sandbox: true, backgroundThrottling: false },
    });
    globalThis.browserCaptureFixture = source;
    await source.loadURL(
      "data:text/html,<body style='margin:0;background:rgb(30,90,150)'><canvas id='c' width='320' height='240'></canvas><script>let n=0;setInterval(()=>{const ctx=c.getContext('2d');ctx.fillStyle=window.captureTestColor||'rgb(30,90,150)';ctx.fillRect(0,0,320,240);ctx.fillStyle=(n++%2)?'white':'red';ctx.fillRect(0,0,16,16)},33)</script>",
    );
    source.showInactive();
    return source.getNativeWindowHandle().readBigUInt64LE().toString();
  });
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
    window.captureTestVideo = video;
    window.stopCaptureTest = async () => {
      generator.stop();
      await writer.abort().catch(() => {});
      video.srcObject = null;
      await window.pibble.stopWindowVideo();
    };
    return { info, frames, dimensions, pixel };
  }, hwnd);
  assert.ok(["DWM · GPU", "Окно · CPU → GPU"].includes(result.info.backend));
  assert.equal(result.info.borderless, true);
  assert.ok(result.frames >= 20, JSON.stringify(result));
  assert.deepEqual(result.dimensions, [result.info.width, result.info.height]);
  [30, 90, 150].forEach((value, i) =>
    assert.ok(Math.abs(result.pixel[i] - value) <= 5, JSON.stringify(result)),
  );
  await app.evaluate(async () => {
    await globalThis.browserCaptureFixture.webContents.executeJavaScript(
      "window.captureTestColor = 'rgb(180,60,40)'",
    );
  });
  await page.waitForFunction(
    () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 8;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(window.captureTestVideo, 0, 0, 8, 8);
      const pixel = ctx.getImageData(4, 4, 1, 1).data;
      return [180, 60, 40].every((value, i) => Math.abs(pixel[i] - value) <= 5);
    },
    {},
    { timeout: 5000 },
  );
  await page.evaluate(() => window.stopCaptureTest());
  console.log(
    "Borderless capture → NT GPU texture → Electron → video track passed:",
    result,
  );
} finally {
  await app?.close();
}
