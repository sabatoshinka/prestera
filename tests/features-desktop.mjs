import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";

const root = process.cwd(),
  run = Date.now(),
  apps = [],
  errors = [];
const exe = process.env.PIBBLE_TEST_EXE;
await fs.mkdir("test-results", { recursive: true });
function wav(duration, frequency = 440) {
  const rate = 16000,
    count = duration * rate,
    b = Buffer.alloc(44 + count * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++)
    b.writeInt16LE(
      Math.round(Math.sin((i / rate) * Math.PI * 2 * frequency) * 4000),
      44 + i * 2,
    );
  return b;
}
async function launch(name) {
  const env = {
    ...process.env,
    PIBBLE_TEST: "1",
    PIBBLE_DATA_DIR: path.join(root, ".cache", `features-${run}-${name}`),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    ...(exe ? { executablePath: exe } : {}),
    args: [...(exe ? [] : [root]), "--mute-audio"],
    env,
  });
  apps.push(app);
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByText("Собери свою стаю.").waitFor();
  const preferences = await page.evaluate(() => window.pibble.getSettings());
  await app.evaluate(({ ipcMain }, preferences) => {
    ipcMain.removeHandler("settings:get");
    ipcMain.handle("settings:get", () => ({
      ...preferences,
      legacyWindowCapture: false,
    }));
  }, preferences);
  await page.reload();
  await page.getByText("Собери свою стаю.").waitFor();
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("clipboard:write");
    ipcMain.handle("clipboard:write", (_e, value) => {
      globalThis.testInvite = value;
    });
    ipcMain.removeHandler("file:save");
    ipcMain.handle("file:save", (_e, value) => {
      globalThis.testSavedFile = value.name;
      return true;
    });
    ipcMain.removeHandler("capture:sources");
    ipcMain.handle("capture:sources", () => [
      { id: "window:123:0", name: "Тестовая демонстрация", thumbnail: "" },
    ]);
    ipcMain.removeHandler("capture:select");
    ipcMain.handle("capture:select", () => true);
  });
  await page.evaluate(() => {
    window.testCues = [];
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.src.includes("/events/"))
        window.testCues.push(this.src.split("/").pop());
      return originalPlay.call(this);
    };
    window.testConnections = [];
    const Original = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Original {
      constructor(options) {
        super(options);
        window.testConnections.push(this);
      }
    };
    const canvasStream = (width, height) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d"),
        stream = canvas.captureStream(30);
      let tick = 0;
      const draw = () => {
        ctx.fillStyle = "#423453";
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = "#c5b5e8";
        ctx.fillRect((tick++ * 8) % (width - 100), height / 3, 100, 100);
      };
      draw();
      const timer = setInterval(() => {
        if (stream.getVideoTracks()[0].readyState === "ended")
          clearInterval(timer);
        else draw();
      }, 33);
      return stream;
    };
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = new MediaStream();
      if (constraints.audio) {
        const ctx = new AudioContext(),
          source = ctx.createOscillator(),
          gain = ctx.createGain(),
          destination = ctx.createMediaStreamDestination();
        source.frequency.value = 300;
        gain.gain.value = 0.05;
        source.connect(gain).connect(destination);
        source.start();
        await ctx.resume();
        const track = destination.stream.getAudioTracks()[0];
        stream.addTrack(track);
        const timer = setInterval(() => {
          if (track.readyState === "ended") {
            clearInterval(timer);
            source.stop();
            ctx.close();
          }
        }, 100);
      }
      if (constraints.video)
        stream.addTrack(canvasStream(640, 360).getVideoTracks()[0]);
      return stream;
    };
    navigator.mediaDevices.getDisplayMedia = async () =>
      canvasStream(1280, 720);
  });
  return { app, page };
}
async function imageFile(page, name, color) {
  const data = await page.evaluate((color) => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 500;
    const g = canvas.getContext("2d");
    g.fillStyle = color;
    g.fillRect(0, 0, 800, 500);
    g.fillStyle = "#c5b5e8";
    g.beginPath();
    g.arc(400, 250, 120, 0, Math.PI * 2);
    g.fill();
    return canvas.toDataURL("image/png").split(",")[1];
  }, color);
  return { name, mimeType: "image/png", buffer: Buffer.from(data, "base64") };
}
async function range(page, name, value) {
  await page.getByRole("slider", { name, exact: true }).fill(String(value));
}

try {
  const { app: hostApp, page: host } = await launch("host");
  const photo = await imageFile(host, "profile.png", "#243c4d");
  await host.getByRole("button", { name: "Настройки", exact: true }).click();
  await host
    .getByRole("button", { name: "Профиль и данные", exact: true })
    .click();
  await host.getByLabel("Выбрать аватар", { exact: true }).setInputFiles(photo);
  await host.locator(".avatar-editor img").waitFor();
  await host.getByLabel("Выбрать фон", { exact: true }).setInputFiles(photo);
  await host.waitForFunction(() =>
    document
      .querySelector(".background-preview")
      .style.backgroundImage.includes("data:image"),
  );
  await host
    .getByLabel("Статус присутствия", { exact: true })
    .selectOption("away");
  await host
    .getByLabel("Текстовый статус", { exact: true })
    .fill("Слушаю дождь");
  await host
    .getByLabel("Обо мне", { exact: true })
    .fill("Мой маленький клуб.\nГлитч и пиблы.");
  await host.getByLabel("Выбрать баннер", { exact: true }).setInputFiles(photo);
  await host.getByRole("button", { name: "Рамка Сигнал", exact: true }).click();
  await host.waitForFunction(() =>
    document
      .querySelector(".profile-customization .profile-banner")
      .style.backgroundImage.includes("data:image"),
  );
  await host
    .locator(".profile-customization .profile-card")
    .scrollIntoViewIfNeeded();
  await host.screenshot({ path: "test-results/profiles-editor.png" });
  await host.screenshot({ path: "test-results/features-profile.png" });
  await host
    .getByRole("button", { name: "Сохранить настройки", exact: true })
    .click();
  await host.locator(".app-shell.has-background").waitFor();

  await host.getByRole("button", { name: /Создать комнату/ }).click();
  await host.getByLabel("Как тебя зовут").fill("Пибл Один");
  await host.getByLabel("Название комнаты").fill("Новая стая");
  await host.locator("summary").click();
  await host.getByLabel("Порт комнаты").fill("46725");
  await host.getByLabel("Адрес для приглашения").fill("127.0.0.1");
  await host
    .getByRole("button", { name: "Создать комнату", exact: true })
    .click();
  await host
    .getByRole("heading", { name: "Новая стая", exact: true })
    .waitFor();
  await host.getByRole("button", { name: "Приглашение", exact: true }).click();
  const invite = await hostApp.evaluate(() => globalThis.testInvite);
  const { app: guestApp, page: guest } = await launch("guest");
  await guest.getByRole("button", { name: /Ввести приглашение/ }).click();
  await guest.getByLabel("Как тебя зовут").fill("Пибл Два");
  await guest.getByLabel("Приглашение или адрес с ключом").fill(invite);
  await guest
    .getByRole("button", { name: "Зайти к друзьям", exact: true })
    .click();
  await guest
    .getByText("P2P · 1 на связи", { exact: true })
    .waitFor({ timeout: 25000 });
  await guest.getByAltText("Аватар Пибл Один").first().waitFor();
  await guest
    .locator(".sidebar-person")
    .filter({ hasText: "Пибл Один" })
    .click();
  await guest
    .getByRole("dialog", { name: "Профиль Пибл Один", exact: true })
    .waitFor();
  await guest
    .locator(".profile-card")
    .getByText("Слушаю дождь", { exact: true })
    .waitFor();
  assert.equal(
    await guest.locator(".profile-card .avatar-frame").getAttribute("src"),
    "frames/signal.svg",
  );
  await guest.waitForFunction(() =>
    document
      .querySelector(".profile-card .profile-banner")
      .style.backgroundImage.includes("data:image"),
  );
  await guest.screenshot({ path: "test-results/profiles-peer.png" });
  await guest.getByRole("button", { name: "Закрыть", exact: true }).click();
  await host.screenshot({ path: "test-results/background-room.png" });
  assert.ok(
    (
      await hostApp.evaluate(({ app }) =>
        app.commandLine.getSwitchValue("disable-features"),
      )
    ).includes("WebRtcWgcRequireBorder"),
  );
  assert.equal(await guest.locator(".app-shell.has-background").count(), 0);
  console.log("PASS profile: avatar reaches peer; background remains local.");

  await host
    .getByRole("button", { name: "Звуковая панель", exact: true })
    .click();
  assert.equal(
    await host
      .locator(".sidebar nav")
      .getByText("Звуковая панель", { exact: true })
      .count(),
    0,
  );
  await range(host, "Громкость звуков", 37);
  await host
    .getByLabel("Добавить звук", { exact: true })
    .setInputFiles({
      name: "long-recording.wav",
      mimeType: "audio/wav",
      buffer: wav(40),
    });
  await host.getByLabel("Начало, сек", { exact: true }).fill("5");
  await host.getByLabel("Конец, сек", { exact: true }).fill("8");
  await host.getByLabel("Название звука").fill("Короткий пибл");
  await host.screenshot({ path: "test-results/features-trim.png" });
  await host
    .getByRole("button", { name: "Прослушать фрагмент", exact: true })
    .click();
  await host
    .getByRole("button", { name: "Сохранить фрагмент", exact: true })
    .click();
  await host.getByRole("button", { name: /Короткий пибл 3.0 сек/ }).waitFor();
  const stored = await host.evaluate(async () => {
    const req = indexedDB.open("pibble-club", 2);
    const db = await new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result);
    });
    const all = db.transaction("sounds").objectStore("sounds").getAll();
    const sounds = await new Promise((resolve) => {
      all.onsuccess = () => resolve(all.result);
    });
    const sound = sounds.find((s) => s.name === "Короткий пибл");
    const audio = new AudioContext();
    const decoded = await audio.decodeAudioData(await sound.blob.arrayBuffer());
    await audio.close();
    db.close();
    return { duration: decoded.duration, size: sound.blob.size };
  });
  assert.ok(Math.abs(stored.duration - 3) < 0.01);
  assert.ok(stored.size < 400000);
  await host
    .getByRole("button", { name: "Редактировать Короткий пибл", exact: true })
    .click();
  await host.getByLabel("Конец, сек", { exact: true }).fill("2");
  await host
    .getByRole("button", { name: "Сохранить фрагмент", exact: true })
    .click();
  await host.getByRole("button", { name: /Короткий пибл 2.0 сек/ }).waitFor();
  await host.screenshot({ path: "test-results/features-sounds.png" });
  await host.getByRole("button", { name: "Закрыть панель звуков" }).click();
  console.log(
    "PASS soundboard: dock, volume, 40-second input trimmed to 3-second WAV, preview.",
  );

  await host.locator(".chat input[type=file]").setInputFiles(photo);
  await guest
    .getByRole("button", { name: "Открыть изображение profile.png" })
    .click();
  await guest
    .getByRole("dialog", { name: "profile.png", exact: true })
    .waitFor();
  await guest.getByRole("button", { name: "Увеличить изображение" }).click();
  assert.equal(
    await guestApp.evaluate(() => globalThis.testSavedFile),
    undefined,
  );
  await guest.getByRole("button", { name: "Скачать изображение" }).click();
  await guestApp.evaluate(async () => {
    const deadline = Date.now() + 5000;
    while (!globalThis.testSavedFile && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert.equal(
    await guestApp.evaluate(() => globalThis.testSavedFile),
    "profile.png",
  );
  await guest.screenshot({ path: "test-results/features-image.png" });
  await guest.getByRole("button", { name: "Закрыть просмотр" }).click();

  await host.getByRole("button", { name: /^Камера ·/ }).click();
  await guest
    .getByRole("button", { name: "Развернуть камеру Пибл Один" })
    .click();
  await guest.waitForFunction(() =>
    document.fullscreenElement?.classList.contains("media-viewer"),
  );
  await guest.waitForFunction(
    () => document.querySelector(".media-viewer video").videoWidth > 0,
  );
  await guest.screenshot({ path: "test-results/features-camera.png" });
  await guest.mouse.move(100, 100);
  const viewer = guest.locator(".media-viewer");
  await viewer
    .getByRole("button", { name: "Открыть чат просмотра", exact: true })
    .click();
  await viewer.locator(".chat textarea").fill("Привет из полного экрана");
  await viewer.locator(".chat textarea").press("Enter");
  await host.getByText("Привет из полного экрана", { exact: true }).waitFor();
  await viewer
    .getByRole("button", {
      name: "Открыть изображение profile.png",
      exact: true,
    })
    .click();
  await viewer.locator(".media-viewer").waitFor();
  assert.ok(
    await guest.evaluate(() =>
      document.fullscreenElement?.classList.contains("stream-viewer"),
    ),
  );
  await viewer
    .locator(".media-viewer")
    .getByRole("button", { name: "Закрыть просмотр", exact: true })
    .click();
  await guest.waitForFunction(
    () => !!document.querySelector(".viewer-person.speaking"),
  );
  await guest.waitForFunction(() => {
    const video = document.querySelector(".stream-viewer > .viewer-content > video");
    if (!video || video.paused || video.readyState < 2) return false;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data[2] > 60;
  });
  await guest.locator(".stream-viewer > .viewer-content > video").evaluate(v => new Promise(resolve => v.requestVideoFrameCallback(() => v.requestVideoFrameCallback(resolve))));
  await guest.screenshot({ path: "test-results/fullscreen-chat.png" });
  await viewer
    .getByRole("button", { name: "Профиль Пибл Один", exact: true })
    .click();
  await guest.locator(".media-viewer .profile-card").waitFor();
  await guest.getByRole("button", { name: "Закрыть", exact: true }).click();
  await viewer
    .getByRole("button", { name: "Микрофон просмотра", exact: true })
    .click();
  await guest.waitForFunction(() => window.testCues.includes("mic-off.wav"));
  await guestApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send("hotkey", "mic"),
  );
  await guest.waitForFunction(() => window.testCues.includes("mic-on.wav"));
  assert.ok(
    await viewer
      .getByRole("button", { name: "Микрофон просмотра", exact: true })
      .evaluate((el) => el.classList.contains("active")),
  );
  for (const label of ["Наушники просмотра", "Камера просмотра"]) {
    await viewer.getByRole("button", { name: label, exact: true }).click();
    await viewer.getByRole("button", { name: label, exact: true }).click();
  }
  await guest.waitForFunction(() =>
    [
      "deafen-on.wav",
      "deafen-off.wav",
      "camera-on.wav",
      "camera-off.wav",
    ].every((c) => window.testCues.includes(c)),
  );
  await viewer
    .getByRole("button", { name: "Скрыть участников", exact: true })
    .click();
  assert.equal(await viewer.locator(".viewer-person").count(), 0);
  await viewer
    .getByRole("button", { name: "Закрыть чат просмотра", exact: true })
    .click();
  await guest.mouse.move(340, 240);
  await guest.waitForFunction(() =>
    document.querySelector(".media-viewer").classList.contains("idle"),
  );
  await guest.mouse.move(350, 230);
  await guest.waitForFunction(
    () => !document.querySelector(".media-viewer").classList.contains("idle"),
  );
  const controlBox = await viewer.locator(".viewer-controls").boundingBox();
  await guest.mouse.move(
    controlBox.x + controlBox.width / 2,
    controlBox.y + controlBox.height / 2,
    { steps: 8 },
  );
  await guest.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".viewer-bottom")).opacity ===
      "1",
  );
  await viewer
    .getByRole("button", { name: "Демонстрация просмотра", exact: true })
    .click();
  await viewer
    .getByRole("dialog", { name: "Покажи, что у тебя", exact: true })
    .waitFor();
  await viewer.getByRole("button", { name: "Закрыть", exact: true }).click();
  await guest.getByRole("button", { name: "Закрыть просмотр" }).click();
  await guest.waitForFunction(() => !document.fullscreenElement);
  await host.getByRole("button", { name: /^Демонстрация ·/ }).click();
  await host
    .getByRole("button", { name: "Тестовая демонстрация", exact: true })
    .click();
  await host.getByLabel("Что слышат друзья").selectOption("none");
  await host
    .getByRole("button", { name: "Начать демонстрацию", exact: true })
    .click();
  await guest
    .getByRole("button", { name: "Демонстрация на весь экран", exact: true })
    .click();
  await guest.waitForFunction(() =>
    document.fullscreenElement?.classList.contains("media-viewer"),
  );
  await guest.waitForFunction(
    () => document.querySelector(".media-viewer video").videoWidth === 1280,
  );
  await guest.screenshot({ path: "test-results/features-screen.png" });
  await guest.mouse.move(120, 110);
  await guest.getByRole("button", { name: "Закрыть просмотр" }).click();
  console.log(
    "PASS media: in-app image viewer/download, webcam and screen fullscreen.",
  );

  await host.getByRole("button", { name: "Настройки", exact: true }).click();
  await host.getByRole("switch", { name: "Отсекать тихие звуки" }).click();
  await range(host, "Порог срабатывания", -35);
  await host.getByRole("button", { name: "Проверить микрофон" }).click();
  await host.waitForFunction(() =>
    document.querySelector(".mic-test-row small").textContent.includes("дБ"),
  );
  await host.screenshot({ path: "test-results/features-microphone.png" });
  await host.getByRole("button", { name: "Остановить проверку" }).click();
  await host
    .getByRole("button", { name: "Сохранить настройки", exact: true })
    .click();
  await host.getByRole("button", { name: /^Микрофон ·/ }).click();
  await host.getByRole("button", { name: "Музыка", exact: true }).click();
  await host.getByLabel("Добавить музыку", { exact: true }).setInputFiles([
    { name: "First.wav", mimeType: "audio/wav", buffer: wav(20, 880) },
    { name: "Second.wav", mimeType: "audio/wav", buffer: wav(20, 660) },
  ]);
  await host
    .getByRole("button", { name: "Включить музыку", exact: true })
    .click();
  await guest.waitForFunction(async () => {
    const pc = window.testConnections[0],
      track = pc.getTransceivers()[4]?.receiver.track;
    if (!track) return false;
    return [...(await pc.getStats()).values()].some(
      (s) =>
        s.type === "inbound-rtp" &&
        s.trackIdentifier === track.id &&
        s.totalAudioEnergy > 0.001,
    );
  });
  await host.getByRole("button", { name: "Следующий трек" }).click();
  await host.locator(".music-now").filter({ hasText: "Second" }).waitFor();
  await range(host, "Громкость музыки", 40);
  await host.getByRole("button", { name: "Закрыть музыку" }).click();
  await host.getByRole("button", { name: "Музыка", exact: true }).click();
  await host.getByRole("button", { name: "Пауза музыки" }).waitFor();
  await host.screenshot({ path: "test-results/features-music.png" });
  await host.getByRole("button", { name: "Пауза музыки" }).click();
  await host
    .getByRole("button", { name: "Включить музыку", exact: true })
    .waitFor();
  console.log(
    "PASS music: queue, independent audio track reaches peer with microphone muted, next/pause/volume.",
  );
  await host.route("https://open.spotify.com/embed/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<p>Spotify embed test placeholder</p>",
    }),
  );
  await host
    .getByRole("button", { name: "Spotify · у себя", exact: true })
    .click();
  await host
    .getByLabel("Ссылка Spotify", { exact: true })
    .fill("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M");
  await host
    .getByRole("button", { name: "Открыть плеер", exact: true })
    .click();
  await host.locator('iframe[title="Spotify"]').waitFor();
  const frame = await host
    .locator('iframe[title="Spotify"]')
    .getAttribute("src");
  assert.equal(
    frame,
    "https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M?theme=0",
  );
  await host.getByRole("button", { name: "Закрыть музыку" }).click();
  await host.getByRole("button", { name: "Музыка", exact: true }).click();
  assert.equal(
    await host.locator('iframe[title="Spotify"]').getAttribute("src"),
    frame,
  );
  console.log(
    "PASS Spotify embed URL and persistence (network/player mocked; full playback not tested).",
  );
  await host.getByRole("button", { name: "Закрыть музыку" }).click();
  await host
    .getByRole("button", { name: "Выйти из комнаты", exact: true })
    .click();
  await guest.getByText("Собери свою стаю.").waitFor();
  await host.waitForFunction(() => window.testCues.includes("leave.wav"));
  const cues = await host.evaluate(() => window.testCues);
  for (const cue of [
    "join.wav",
    "leave.wav",
    "mic-on.wav",
    "mic-off.wav",
    "camera-on.wav",
    "screen-on.wav",
  ])
    assert.ok(cues.includes(cue), `Missing cue ${cue}`);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    "test-results/features.json",
    JSON.stringify(
      {
        version: await hostApp.evaluate(({ app }) => app.getVersion()),
        packaged: !!exe,
        passed: true,
        hardwareAccess: false,
        checks: [
          "avatars",
          "local-background",
          "sound-dock",
          "sound-trim",
          "volume",
          "image-viewer",
          "webcam-fullscreen",
          "screen-fullscreen",
          "profiles-presence-status-bio-banner-frames",
          "fullscreen-chat-images-controls-hotkeys",
          "fullscreen-participants-speaking-autohide",
          "local-event-sounds",
          "microphone-gate-settings",
          "music-queue",
          "music-with-mic-muted",
        ],
      },
      null,
      2,
    ),
  );
} catch (error) {
  for (let i = 0; i < apps.length; i++) {
    const page = await apps[i].firstWindow();
    await page
      .screenshot({ path: `test-results/features-failure-${i}.png` })
      .catch(() => {});
    console.log("UI", i, (await page.locator("body").innerText()).slice(-2300));
  }
  throw error;
} finally {
  for (const app of apps.reverse()) await app.close().catch(() => {});
}
