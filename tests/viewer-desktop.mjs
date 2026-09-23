import { _electron as electron } from "playwright";
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
const fixture = await build({
  entryPoints: ["tests/viewer-fixture.jsx"],
  bundle: true,
  write: false,
  format: "iife",
  define: { "process.env.NODE_ENV": '"production"' },
});
const env = {
  ...process.env,
  PIBBLE_TEST: "1",
  PIBBLE_DATA_DIR: path.resolve(`.cache/viewer-${Date.now()}`),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [process.cwd(), "--mute-audio"],
  env,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForFunction(() => !!window.pibble);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia =
      navigator.mediaDevices.getDisplayMedia = async () => {
        throw new Error("Device capture forbidden");
      };
    window.fullscreenCalls = 0;
    Element.prototype.requestFullscreen = async function () {
      window.fullscreenCalls++;
      Object.defineProperty(document, "fullscreenElement", {
        configurable: true,
        value: this,
      });
      document.dispatchEvent(new Event("fullscreenchange"));
    };
    document.exitFullscreen = async () => {
      Object.defineProperty(document, "fullscreenElement", {
        configurable: true,
        value: null,
      });
      document.dispatchEvent(new Event("fullscreenchange"));
    };
  });
  await app.evaluate(
    ({ BrowserWindow }, code) =>
      BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(code),
    fixture.outputFiles[0].text,
  );
  await page.locator(".media-viewer").waitFor();
  assert.deepEqual(await page.evaluate(() => window.verifySenderRefresh()), {
    preference: "maintain-resolution",
    bitrate: 2_000_000,
    sameTrack: true,
    live: true,
  });
  assert.equal(await page.evaluate(() => window.fullscreenCalls), 0);
  const floating = page.locator(".floating-video:visible");
  const before = await floating.boundingBox();
  const handle = await floating.locator(".floating-handle").boundingBox();
  await page.mouse.move(handle.x + 30, handle.y + 10);
  await page.mouse.down();
  await page.mouse.move(handle.x + 150, handle.y + 80);
  await page.mouse.up();
  const moved = await floating.boundingBox();
  assert.ok(moved.x > before.x + 70);
  const resize = await floating.locator(".floating-resize").boundingBox();
  await page.mouse.move(resize.x + 12, resize.y + 12);
  await page.mouse.down();
  await page.mouse.move(resize.x + 100, resize.y + 70);
  await page.mouse.up();
  assert.ok((await floating.boundingBox()).width > before.width + 50);
  await floating.locator(".floating-focus").click();
  await page.waitForFunction(
    () =>
      document.querySelector(".media-viewer > header > b").textContent ===
      "camera",
  );
  assert.equal(
    await page.locator(".floating-video:visible .floating-handle").innerText(),
    "Guest · демонстрация",
  );
  await page
    .getByRole("button", { name: "На весь экран", exact: true })
    .click();
  assert.equal(await page.evaluate(() => window.fullscreenCalls), 1);
  await page
    .getByRole("button", { name: "Звуковая панель просмотра", exact: true })
    .click();
  const sounds = page.locator(".media-viewer .viewer-sounds");
  await sounds.getByRole("button", { name: /Тестовый звук.*1.0/ }).click();
  assert.equal(await page.evaluate(() => window.soundPlayed), 1);
  await sounds.getByRole("slider", { name: "Громкость звуков" }).fill("70");
  assert.equal(await page.evaluate(() => window.soundVolume), 70);
  await page.waitForTimeout(3500);
  assert.equal(await page.locator(".media-viewer.idle").count(), 0);
  await page.keyboard.press("Escape");
  assert.equal(await sounds.count(), 0);
  assert.equal(await page.evaluate(() => !!document.fullscreenElement), true);
  await page
    .getByRole("button", { name: "Выйти из полноэкранного режима" })
    .click();
  assert.equal(await page.locator(".media-viewer").count(), 1);
  await page.getByRole("button", { name: "Скрыть участников" }).click();
  assert.equal(await page.locator(".floating-video:visible").count(), 0);
  await page.getByRole("button", { name: "Открыть чат просмотра" }).click();
  await page.getByRole("button", { name: "Открыть тестовую картинку" }).click();
  await page.locator(".viewer-image img").waitFor();
  await page.waitForFunction(
    () => document.querySelector(".viewer-image img")?.naturalWidth === 640,
  );
  assert.equal(await page.evaluate(() => window.saved), undefined);
  await page
    .getByRole("button", { name: "Закрыть просмотр", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "Профиль", exact: true }).click();
  assert.equal(await page.locator(".popover-close svg").count(), 1);
  await page.getByRole("button", { name: "Закрыть карточку" }).click();
  assert.deepEqual(errors, []);
  console.log(
    "Viewer: app expansion, explicit fullscreen, floating move/resize/focus, images, profile close passed (synthetic media only)",
  );
} finally {
  await app.close();
}
