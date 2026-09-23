import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";

const root = process.cwd();
const { version } = JSON.parse(await fs.readFile("package.json", "utf8"));
const executablePath = process.env.PIBBLE_TEST_EXE;
const advertisedAddress = process.env.PIBBLE_TEST_ADDRESS || "127.0.0.1";
const apps = [],
  errors = [];
const run = Date.now().toString();
await fs.mkdir("test-results", { recursive: true });

async function launch(name) {
  const env = {
    ...process.env,
    PIBBLE_TEST: "1",
    PIBBLE_DATA_DIR: path.join(root, ".cache", `security-${run}-${name}`),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : [root]), "--mute-audio"],
    env,
  });
  apps.push(app);
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByText("Собери свою стаю.").waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].hide(),
  );
  // Capture this test process's copy action without reading/writing the OS clipboard.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("clipboard:write");
    ipcMain.handle("clipboard:write", (_event, value) => {
      globalThis.securityTestInvite = String(value);
    });
  });
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException(
        "Hardware disabled by security test",
        "NotAllowedError",
      );
    };
    navigator.mediaDevices.getDisplayMedia = async () => {
      throw new Error("Screen capture is forbidden in this test");
    };
    window.securityConnections = [];
    const Original = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Original {
      constructor(options) {
        super(options);
        window.securityConnections.push(this);
      }
    };
  });
  return { app, page };
}

try {
  const { app: hostApp, page: host } = await launch("host");
  const runtime = await hostApp.evaluate(({ app }) => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    electron: process.versions.electron,
  }));
  assert.equal(runtime.version, version);
  if (executablePath) assert.equal(runtime.packaged, true);
  await host.getByRole("button", { name: /Создать комнату/ }).click();
  await host.getByLabel("Как тебя зовут").fill("Пибл Один");
  await host.getByLabel("Название комнаты").fill("Защищённая стая");
  await host.locator("summary").click();
  await host.getByLabel("Порт комнаты").fill("46724");
  await host.getByLabel("Адрес для приглашения").fill(advertisedAddress);
  await host
    .getByRole("button", { name: "Создать комнату", exact: true })
    .click();
  await host
    .getByRole("heading", { name: "Защищённая стая", exact: true })
    .waitFor();
  // Regression: the host must remain alone past the old 8-second TCP timeout.
  await new Promise((resolve) => setTimeout(resolve, 12000));
  assert.equal(
    await host
      .getByRole("heading", { name: "Защищённая стая", exact: true })
      .count(),
    1,
  );
  await host.getByRole("button", { name: "Приглашение", exact: true }).click();
  const invite = await hostApp.evaluate(() => globalThis.securityTestInvite);
  assert.match(invite, /^pibble:\/\/join/);
  const { page: guest } = await launch("guest");
  await guest.getByRole("button", { name: /Ввести приглашение/ }).click();
  await guest.getByLabel("Как тебя зовут").fill("Пибл Два");
  await guest.getByLabel("Приглашение или адрес с ключом").fill(invite);
  await guest
    .getByRole("button", { name: "Зайти к друзьям", exact: true })
    .click();
  for (const page of [host, guest])
    await page
      .getByText("P2P · 1 на связи", { exact: true })
      .waitFor({ timeout: 25000 });
  // Hold the real desktop room open through two WebSocket heartbeat periods.
  await new Promise((resolve) => setTimeout(resolve, 32000));
  for (const page of [host, guest])
    assert.equal(
      await page.getByText("P2P · 1 на связи", { exact: true }).count(),
      1,
    );
  for (const [from, to, message] of [
    [host, guest, "X25519: привет стае"],
    [guest, host, "Чат работает в обе стороны"],
  ]) {
    await from
      .getByRole("textbox", { name: "Сообщение", exact: true })
      .fill(message);
    await from.getByRole("button", { name: "Отправить", exact: true }).click();
    await to.getByText(message, { exact: true }).waitFor();
  }
  const payload = crypto.randomBytes(600_000);
  await host.locator(".chat input[type=file]").setInputFiles({
    name: "security-test.bin",
    mimeType: "application/octet-stream",
    buffer: payload,
  });
  await guest.getByText("security-test.bin", { exact: true }).waitFor();
  const hash = await guest.evaluate(async () => {
    const req = indexedDB.open("pibble-club", 2);
    const db = await new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result);
    });
    const all = db.transaction("messages").objectStore("messages").getAll();
    const messages = await new Promise((resolve) => {
      all.onsuccess = () => resolve(all.result);
    });
    const file = messages.find(
      (message) => message.file?.name === "security-test.bin",
    ).file;
    const digest = await crypto.subtle.digest(
      "SHA-256",
      await file.blob.arrayBuffer(),
    );
    db.close();
    return [...new Uint8Array(digest)]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  });
  assert.equal(hash, crypto.createHash("sha256").update(payload).digest("hex"));
  const transports = await guest.evaluate(async () => {
    const records = [];
    for (const pc of window.securityConnections)
      for (const stat of (await pc.getStats()).values())
        if (stat.type === "transport")
          records.push({
            dtlsState: stat.dtlsState,
            dtlsCipher: stat.dtlsCipher,
            srtpCipher: stat.srtpCipher,
          });
    return records;
  });
  assert.ok(transports.some((t) => t.dtlsState === "connected"));
  await host
    .getByRole("button", { name: "Выйти из комнаты", exact: true })
    .click();
  await guest.getByText("Собери свою стаю.").waitFor({ timeout: 10000 });
  assert.deepEqual(errors, []);
  await fs.writeFile(
    "test-results/security-desktop.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        runtime,
        transports,
        fileBytes: payload.length,
        sha256: hash,
        hardwareAccess: false,
        hostIdleMs: 12000,
        connectedIdleMs: 32000,
        passed: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: two desktop clients, authenticated room, direct WebRTC/DTLS, bidirectional chat, 600 KB file SHA-256, host disconnect; no microphone, camera or screen capture.",
  );
} finally {
  for (const app of apps.reverse()) await app.close().catch(() => {});
}
