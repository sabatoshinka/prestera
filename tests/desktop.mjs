import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const base = process.cwd();
await fs.mkdir("test-results", { recursive: true });
const apps = [],
  errors = [];
async function launch(name) {
  const env = {
    ...process.env,
    PIBBLE_TEST: "1",
    PIBBLE_DATA_DIR: path.join(base, ".cache", "test-" + name),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: [base, "--mute-audio"],
    env,
  });
  apps.push(app);
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(name + ": " + error.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(name, msg.text());
  });
  await page.getByText("Собери свою стаю.").waitFor();
  await page.evaluate(() => {
    // Virtualise ONLY getUserMedia. getDisplayMedia must keep using the real
    // Windows capture path. No microphone or camera hardware is opened.
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const result = new MediaStream();
      if (constraints.audio) {
        const context = new AudioContext({ sampleRate: 48000 });
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        gain.gain.value = 0.1;
        const destination = context.createMediaStreamDestination();
        oscillator.connect(gain).connect(destination);
        oscillator.start();
        await context.resume();
        const track = destination.stream.getAudioTracks()[0];
        result.addTrack(track);
        const timer = setInterval(() => {
          if (track.readyState === "ended") {
            clearInterval(timer);
            oscillator.stop();
            context.close();
          }
        }, 300);
      }
      if (constraints.video) {
        const canvas = document.createElement("canvas");
        canvas.width = 1280;
        canvas.height = 720;
        const context = canvas.getContext("2d");
        let frame = 0;
        const stream = canvas.captureStream(30),
          track = stream.getVideoTracks()[0];
        const timer = setInterval(() => {
          if (track.readyState === "ended") return clearInterval(timer);
          context.fillStyle = "#25202e";
          context.fillRect(0, 0, 1280, 720);
          context.fillStyle = "#c5b5e8";
          context.fillRect((frame++ * 12) % 1150, 230, 130, 260);
          context.font = "60px Segoe UI";
          context.fillText("Virtual test camera", 80, 130);
        }, 1000 / 30);
        result.addTrack(track);
      }
      return result;
    };
    window.testConnections = [];
    const Original = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Original {
      constructor(config) {
        super(config);
        window.testConnections.push(this);
      }
    };
  });
  return { app, page };
}
try {
  const { app: hostApp, page: host } = await launch("host");
  await host.screenshot({ path: "test-results/home.png" });
  await host.getByRole("button", { name: /Создать комнату/ }).click();
  await host.getByLabel("Как тебя зовут").fill("Пибл Один");
  await host.getByLabel("Название комнаты").fill("Тестовая стая");
  await host.locator("summary").click();
  await host.getByLabel("Порт комнаты").fill("46722");
  await host.getByLabel("Адрес для приглашения").fill("127.0.0.1");
  await host
    .getByRole("button", { name: "Создать комнату", exact: true })
    .click();
  await host
    .getByRole("heading", { name: "Тестовая стая", exact: true })
    .waitFor();
  await host.getByRole("button", { name: "Приглашение", exact: true }).click();
  const invitation = await hostApp.evaluate(({ clipboard }) =>
    clipboard.readText(),
  );
  assert.match(invitation, /^pibble:\/\/join/);
  const { page: guest } = await launch("guest");
  await guest.getByRole("button", { name: /Ввести приглашение/ }).click();
  await guest.getByLabel("Как тебя зовут").fill("Пибл Два");
  await guest.getByLabel("Приглашение или адрес с ключом").fill(invitation);
  await guest
    .getByRole("button", { name: "Зайти к друзьям", exact: true })
    .click();
  await guest
    .getByText("P2P · 1 на связи", { exact: true })
    .waitFor({ timeout: 25000 });
  await host
    .getByText("P2P · 1 на связи", { exact: true })
    .waitFor({ timeout: 25000 });
  await host
    .getByRole("textbox", { name: "Сообщение", exact: true })
    .fill("Привет, пибл! <script>no execution</script>");
  await host.getByRole("button", { name: "Отправить", exact: true }).click();
  await guest
    .getByText("Привет, пибл! <script>no execution</script>", { exact: true })
    .waitFor();
  await guest
    .getByRole("textbox", { name: "Сообщение", exact: true })
    .fill("Слышу стаю 🐶");
  await guest.getByRole("button", { name: "Отправить", exact: true }).click();
  await host.getByText("Слышу стаю 🐶", { exact: true }).waitFor();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
    "base64",
  );
  await host.locator(".chat input[type=file]").setInputFiles({
    name: "pibble-test.png",
    mimeType: "image/png",
    buffer: png,
  });
  await guest.getByAltText("pibble-test.png", { exact: true }).waitFor();
  const gif = Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64",
  );
  await host.locator(".chat input[type=file]").setInputFiles({
    name: "pibble-test.gif",
    mimeType: "image/gif",
    buffer: gif,
  });
  await guest.getByAltText("pibble-test.gif", { exact: true }).waitFor();
  const payload = crypto.randomBytes(600_000);
  await host.locator(".chat input[type=file]").setInputFiles({
    name: "blocks-test.bin",
    mimeType: "application/octet-stream",
    buffer: payload,
  });
  await guest.getByText("blocks-test.bin", { exact: true }).waitFor();
  const hash = await guest.evaluate(async () => {
    const request = indexedDB.open("pibble-club", 2);
    const db = await new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result);
    });
    const all = db.transaction("messages").objectStore("messages").getAll();
    const messages = await new Promise((resolve) => {
      all.onsuccess = () => resolve(all.result);
    });
    const received = messages
      .filter((m) => m.file?.name === "blocks-test.bin")
      .sort((a, b) => a.time - b.time)
      .at(-1);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      await received.file.blob.arrayBuffer(),
    );
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  });
  assert.equal(hash, crypto.createHash("sha256").update(payload).digest("hex"));
  await host.getByRole("button", { name: /^Камера ·/ }).click();
  await guest.waitForFunction(() =>
    [...document.querySelectorAll(".person-tile video")].some(
      (v) => v.videoWidth > 0,
    ),
  );
  await host.getByRole("button", { name: /^Микрофон ·/ }).click();
  await host.screenshot({ path: "test-results/room.png" });
  await guest.screenshot({ path: "test-results/guest.png" });
  // Capture our own background test window. Never capture the user's screen or other apps.
  const captureHandle = await hostApp.evaluate(async ({ BrowserWindow }) => {
    const target = new BrowserWindow({
      width: 1920,
      height: 1080,
      useContentSize: true,
      frame: false,
      show: false,
      skipTaskbar: true,
      title: "Pibble capture test",
      webPreferences: {
        backgroundThrottling: false,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    const html =
      '<html><head><title>Pibble capture test</title></head><body style="margin:0;overflow:hidden;background:#211d29"><canvas id="c" width="1920" height="1080"></canvas><script>const c=document.getElementById("c"),g=c.getContext("2d");let frame=0;function draw(){frame++;g.fillStyle="#211d29";g.fillRect(0,0,1920,1080);g.fillStyle="#c5b5e8";g.fillRect((frame*12)%1800,240,120,600);g.font="80px Segoe UI";g.fillText("Pibble Club / 1080p motion test",100,150);requestAnimationFrame(draw)}draw()</script></body></html>';
    await target.loadURL(
      "data:text/html;charset=utf-8," + encodeURIComponent(html),
    );
    target.showInactive();
    target.setContentSize(1920, 1080);
    const handle = target.getNativeWindowHandle().readBigUInt64LE().toString();
    global.pibbleCaptureTest = target;
    return handle;
  });
  await promisify(execFile)(
    path.join(base, "native", "bin", "pibble-audio.exe"),
    ["--background-window", captureHandle],
    { windowsHide: true },
  );
  await host.getByRole("button", { name: /^Демонстрация ·/ }).click();
  await host
    .getByRole("button", { name: "Pibble capture test", exact: true })
    .waitFor({ timeout: 10000 });
  await host
    .getByRole("button", { name: "Pibble capture test", exact: true })
    .click();
  await host.screenshot({ path: "test-results/capture-picker.png" });
  await host
    .getByRole("button", { name: "Начать демонстрацию", exact: true })
    .click();
  await guest.waitForFunction(
    () => {
      const video = document.querySelector(".screen-player video");
      return video && video.videoWidth >= 1280 && video.videoHeight > 0;
    },
    { timeout: 20000 },
  );
  await guest.screenshot({ path: "test-results/screenshare.png" });
  await new Promise((resolve) => setTimeout(resolve, 4000));
  const captureStats = await host.evaluate(async () => {
    const pc = window.testConnections[0];
    const stats = await pc.getStats();
    return {
      tracks: pc
        .getSenders()
        .map((s) =>
          s.track
            ? { kind: s.track.kind, settings: s.track.getSettings() }
            : null,
        ),
      outbound: [...stats.values()]
        .filter((r) => r.type === "outbound-rtp" && r.kind === "video")
        .map((r) => ({
          mid: r.mid,
          width: r.frameWidth,
          height: r.frameHeight,
          fps: r.framesPerSecond,
          encoder: r.encoderImplementation,
          limitation: r.qualityLimitationReason,
          codec: stats.get(r.codecId)?.mimeType,
        })),
    };
  });
  await fs.writeFile(
    "test-results/capture-stats.json",
    JSON.stringify(captureStats, null, 2),
  );
  const mediaStats = await guest.evaluate(async () => {
    const report = await window.testConnections[0].getStats();
    return [...report.values()]
      .filter((r) => r.type === "inbound-rtp")
      .map((r) => ({
        kind: r.kind,
        mid: r.mid,
        bytesReceived: r.bytesReceived,
        framesDecoded: r.framesDecoded,
        width: r.frameWidth,
        height: r.frameHeight,
        fps: r.framesPerSecond,
        totalAudioEnergy: r.totalAudioEnergy,
      }));
  });
  await fs.writeFile(
    "test-results/media-stats.json",
    JSON.stringify(mediaStats, null, 2),
  );
  assert.ok(
    mediaStats.some(
      (r) => r.kind === "video" && r.width >= 1280 && r.framesDecoded > 0,
    ),
  );
  assert.ok(
    mediaStats.filter((r) => r.kind === "audio" && r.bytesReceived > 0)
      .length >= 2,
    "Voice and application audio must arrive on separate tracks",
  );
  await host.getByRole("button", { name: /^Демонстрация ·/ }).click();
  await hostApp.evaluate(() => {
    global.pibbleCaptureTest.close();
  });
  await host
    .getByRole("button", { name: "Звуковая панель", exact: true })
    .first()
    .click();
  await host.getByRole("heading", { name: "Скажи это звуком." }).waitFor();
  await host.screenshot({ path: "test-results/soundboard.png" });
  await host.getByRole("button", { name: "Настройки", exact: true }).click();
  await host
    .getByRole("switch", { name: "Шумоподавление", exact: true })
    .click();
  await host
    .getByRole("button", { name: "Горячие клавиши", exact: true })
    .click();
  await host.screenshot({ path: "test-results/settings.png" });
  await host
    .getByRole("button", { name: "Сохранить настройки", exact: true })
    .click();
  await host
    .getByRole("button", { name: "Выйти из комнаты", exact: true })
    .click();
  await guest.getByText("Собери свою стаю.").waitFor({ timeout: 10000 });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: 2 Electron clients, direct WebRTC, chat, PNG/GIF, 600 KB file SHA-256, webcam, native window capture with separate app audio, mic, soundboard, settings, host disconnect.",
  );
} catch (error) {
  for (let i = 0; i < apps.length; i++) {
    const page = await apps[i].firstWindow();
    await page.screenshot({ path: `test-results/failure-${i}.png` });
    console.log(
      "DEBUG",
      i,
      await page.evaluate(() => ({
        text: document.body.innerText.slice(-1200),
        pcs: window.testConnections?.map((pc) => ({
          connection: pc.connectionState,
          ice: pc.iceConnectionState,
          gathering: pc.iceGatheringState,
          signaling: pc.signalingState,
          mediaSections: pc.getTransceivers().map((t) => ({
            mid: t.mid,
            direction: t.direction,
            current: t.currentDirection,
          })),
          localType: pc.localDescription?.type,
          remoteType: pc.remoteDescription?.type,
        })),
      })),
    );
  }
  throw error;
} finally {
  for (const app of apps.reverse()) await app.close().catch(() => {});
}
