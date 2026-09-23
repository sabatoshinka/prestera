import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";

const profile = path.resolve(`.cache/updates-ui-${Date.now()}`);
const env = { ...process.env, PIBBLE_TEST: "1", PIBBLE_DATA_DIR: profile };
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
        throw new Error("Capture forbidden in updater UI check");
      };
  });
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  const range = page.getByRole("slider", {
    name: "Лимит битрейта стрима",
    exact: true,
  });
  await range.fill("35");
  await page
    .getByRole("button", { name: "Сохранить настройки", exact: true })
    .click();
  assert.equal(
    (await page.evaluate(() => window.pibble.getSettings())).streamMbps,
    35,
  );
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  assert.equal(await range.inputValue(), "35");
  await page.getByRole("button", { name: "Обновления", exact: true }).click();
  // The real main-process check uses a fake response, without reaching GitHub.
  await app.evaluate(({ net }) => {
    net.fetch = async () =>
      new Response(
        JSON.stringify({
          tag_name: "v0.7.1",
          draft: false,
          prerelease: false,
          assets: [
            {
              name: "Prestera-0.7.1-win-x64.zip",
              state: "uploaded",
              size: 100,
              digest: "sha256:" + "a".repeat(64),
              browser_download_url:
                "https://github.com/sabatoshinka/prestera/releases/download/v0.7.1/Prestera-0.7.1-win-x64.zip",
            },
          ],
        }),
      );
  });
  await page
    .getByRole("button", { name: "Проверить обновления", exact: true })
    .click();
  await page.getByText("Доступна версия 0.7.1", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Скачать обновление", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(await page.getByText(profile, { exact: true }).count(), 1);
  await fs.mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/updates-settings.png" });
  // A transfer continues in the main process when the settings UI is closed.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send("updates:state", {
      status: "downloading",
      currentVersion: "0.7.0",
      version: "0.7.1",
      enabled: true,
      total: 100,
      received: 40,
    }),
  );
  await page
    .getByRole("progressbar", { name: "Загрузка обновления" })
    .waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send("updates:state", {
      status: "ready",
      currentVersion: "0.7.0",
      version: "0.7.1",
      enabled: true,
    }),
  );
  await page
    .getByRole("button", { name: "Перезапустить и обновить", exact: true })
    .waitFor();
  // This synthetic ready notification cannot bypass the actual main-process state.
  await assert.rejects(
    page.evaluate(() => window.pibble.installUpdate()),
    /не готово/,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Settings UI: bitrate persisted, release detected, download gated in development, progress and restart states rendered. No devices used.",
  );
} finally {
  await app.close();
}
