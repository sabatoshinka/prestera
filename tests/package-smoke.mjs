import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
const root = process.cwd();
const { version } = JSON.parse(await fs.readFile("package.json", "utf8"));
const env = {
  ...process.env,
  PIBBLE_TEST: "1",
  PIBBLE_DATA_DIR: path.join(root, ".cache", "packaged-smoke"),
};
delete env.ELECTRON_RUN_AS_NODE;
const application = await electron.launch({
  executablePath: path.join(
    root,
    "release",
    `Pibble-Club-${version}-win-x64`,
    "Pibble Club.exe",
  ),
  args: ["--mute-audio"],
  env,
});
try {
  const page = await application.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("heading", { name: "Собери свою стаю." }).waitFor();
  assert.equal(await application.evaluate(({ app }) => app.isPackaged), true);
  assert.equal(
    await page.evaluate(
      async () => (await window.pibble.getSettings()).nativeAudio,
    ),
    true,
  );
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page
    .getByRole("button", { name: "Профиль и данные", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Открывать приглашения этим приложением" })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: packaged Windows EXE starts, native audio helper is included, settings and link registration control render.",
  );
} finally {
  await application.close();
}
