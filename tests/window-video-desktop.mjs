import { _electron as electron } from "playwright";
import path from "node:path";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const root = process.cwd(),
  env = {
    ...process.env,
    PIBBLE_TEST: "1",
    PIBBLE_DATA_DIR: path.join(root, ".cache", `capture-${Date.now()}`),
  };
delete env.ELECTRON_RUN_AS_NODE;
const exe = process.env.PIBBLE_TEST_EXE;
const app = await electron.launch({
  ...(exe ? { executablePath: exe } : {}),
  args: [...(exe ? [] : [root]), "--mute-audio"],
  env,
});
try {
  const page = await app.firstWindow();
  await page.getByText("Собери свою стаю.").waitFor();
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new Error("No hardware in this test");
    };
    navigator.mediaDevices.getDisplayMedia = async () => {
      throw new Error("Desktop capture forbidden in this test");
    };
  });
  await app.evaluate(async ({ BrowserWindow, ipcMain }) => {
    const target = new BrowserWindow({
      width: 960,
      height: 600,
      show: false,
      focusable: false,
      backgroundColor: "#193c55",
      webPreferences: { sandbox: true, contextIsolation: true },
    });
    await target.loadURL(
      "data:text/html," +
        encodeURIComponent(
          "<html><head><title>Pibble capture test</title><style>body{margin:0;background:#193c55;color:white;font:32px sans-serif}main{padding:80px}i{display:block;width:160px;height:160px;background:#9ddbaf;border-radius:50%;animation:move 2s infinite alternate}@keyframes move{to{transform:translateX(250px)}}</style></head><body><main>Only this test window is captured<i></i></main></body></html>",
        ),
    );
    target.showInactive();
    globalThis.captureTestWindow = target;
    const hwnd = target.getNativeWindowHandle().readBigUInt64LE().toString();
    ipcMain.removeHandler("capture:sources");
    ipcMain.handle("capture:sources", () => [
      { id: `window:${hwnd}:0`, name: "Pibble capture test", thumbnail: "" },
    ]);
  });
  await page.getByRole("button", { name: /Создать комнату/ }).click();
  await page.locator("summary").click();
  await page.getByLabel("Порт комнаты").fill("46845");
  await page
    .getByRole("button", { name: "Создать комнату", exact: true })
    .click();
  await page.getByRole("button", { name: /^Демонстрация ·/ }).click();
  await page
    .getByRole("button", { name: "Pibble capture test", exact: true })
    .click();
  await page.getByLabel("Что слышат друзья").selectOption("none");
  await page
    .getByRole("button", { name: "Начать демонстрацию", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector(".screen-player video")?.videoWidth > 500,
    {},
    { timeout: 20000 },
  );
  const measurement = await page.evaluate(() => {
    const v = document.querySelector(".screen-player video"),
      c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const g = c.getContext("2d");
    g.drawImage(v, 0, 0);
    const pixels = g.getImageData(0, 0, c.width, c.height).data;
    let blue = 0,
      green = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 2] > 60 && pixels[i + 2] > pixels[i] + 20) blue++;
      if (pixels[i + 1] > 160 && pixels[i + 1] > pixels[i] + 20) green++;
    }
    return {
      width: c.width,
      height: c.height,
      blue,
      green,
      frames: v.getVideoPlaybackQuality().totalVideoFrames,
    };
  });
  assert.ok(
    measurement.blue > 10000 && measurement.green > 1000,
    JSON.stringify(measurement),
  );
  await page.bringToFront();
  await page.screenshot({ path: "test-results/window-without-border.png" });
  await page.getByRole("button", { name: /^Демонстрация ·/ }).click();
  await page.waitForFunction(
    () => !document.querySelector(".screen-player video"),
  );
  await fs.writeFile(
    "test-results/window-video.json",
    JSON.stringify(
      {
        passed: true,
        packaged: !!exe,
        ...measurement,
        capture: "PrintWindow; only a window created by the test",
        hardware: false,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS native window capture without WGC border; decoded colored moving test window; stopped cleanly.",
    measurement,
  );
} finally {
  await app.close();
}
