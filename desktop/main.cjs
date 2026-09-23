const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  session,
  globalShortcut,
  clipboard,
  dialog,
  protocol,
  net,
  shell,
} = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { GpuVideo } = require("./gpu-video.cjs");
const crypto = require("node:crypto");
const { MusicLibrary } = require("./library.cjs");
const { relayUrl, relayInvite, publishRoom } = require("./relay.cjs");
const { pathToFileURL } = require("node:url");
const {
  createRoom,
  RoomClient,
  inviteFor,
  parseInvite,
} = require("./room.cjs");

const root = path.join(__dirname, "..");
const dataRoot =
  process.env.PIBBLE_DATA_DIR ||
  (app.isPackaged
    ? path.join(path.dirname(process.execPath), "PibbleData")
    : path.join(root, ".cache", "profile"));
fs.mkdirSync(dataRoot, { recursive: true });
app.setPath("userData", dataRoot);
if (!process.env.PIBBLE_TEST && !app.requestSingleInstanceLock()) {
  app.quit();
  return;
}
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "pibble-app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
let win,
  host,
  client,
  relayHost,
  selectedCapture,
  captureProcess,
  pendingInvite;
let library;
const musicLibrary = () => (library ||= new MusicLibrary(dataRoot));
let hotkeyFailures = [];
const nativePath = path.join(root, "native", "bin", "pibble-audio.exe");
const legacyWindowCapture =
  process.platform === "win32" &&
  Number(require("node:os").release().split(".")[2]) < 20348;
const windowVideo = new GpuVideo(
  path.join(root, "native", "bin", "prestera-gpu-video.exe"),
  () => win.webContents,
  () => send("window-video-ended", "Захват окна завершился"),
);
const defaults = {
  name: "Участник",
  serverUrl: "",
  serverKey: "",
  connectionMode: "direct",
  forceRelay: false,
  color: 0,
  presence: "online",
  statusText: "",
  bio: "",
  frame: "none",
  banner: "",
  profileColor: "#8773ab",
  eventSounds: true,
  messageSounds: true,
  eventGain: 25,
  captureBorder: false,
  captureMode: "borderless",
  avatar: "",
  background: "",
  backgroundDim: 75,
  accent: "#c5b5e8",
  noiseMode: "standard",
  autoGain: true,
  gateEnabled: false,
  gateThreshold: -52,
  gateHold: 250,
  musicGain: 65,
  noise: true,
  echo: true,
  mic: "",
  output: "",
  camera: "",
  micGain: 100,
  outputGain: 100,
  soundGain: 65,
  quality: "1080p60",
  hotkeys: {
    mic: "Control+Shift+M",
    deafen: "Control+Shift+D",
    camera: "Control+Shift+V",
    screen: "Control+Shift+S",
    sound0: "Control+Alt+1",
    sound1: "Control+Alt+2",
    sound2: "Control+Alt+3",
  },
};
function readSettings() {
  try {
    const value = JSON.parse(
      fs.readFileSync(path.join(dataRoot, "settings.json"), "utf8"),
    );
    return {
      ...defaults,
      ...value,
      name: value.name === "Пибл" ? "Участник" : value.name || defaults.name,
      noiseMode:
        value.noiseMode || (value.noise === false ? "off" : "standard"),
      hotkeys: { ...defaults.hotkeys, ...value.hotkeys },
    };
  } catch {
    return structuredClone(defaults);
  }
}
let settings = readSettings();
// Monitor capture uses Chromium's DXGI path on both Windows 10 and 11.
// Window mode is chosen explicitly per capture, without misleading border flags.
if (process.platform === "win32") {
  const disabled = app.commandLine
    .getSwitchValue("disable-features")
    .split(",")
    .filter(Boolean);
  const withoutBorder = ["AllowWgcScreenCapturer"];
  app.commandLine.appendSwitch(
    "disable-features",
    [...new Set([...disabled, ...withoutBorder])].join(","),
  );
}
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
function stopAudio() {
  if (captureProcess) {
    const proc = captureProcess;
    captureProcess = null;
    proc.kill();
  }
}
async function leave() {
  const priorRelay = relayHost;
  relayHost = null;
  priorRelay?.close();
  windowVideo.stop();
  stopAudio();
  client?.close();
  client = null;
  await host?.close();
  host = null;
}
function registerKeys(keys) {
  if (process.env.PIBBLE_TEST) return [];
  globalShortcut.unregisterAll();
  const failures = [];
  for (const [action, accelerator] of Object.entries(keys)) {
    if (!Object.hasOwn(defaults.hotkeys, action) || !accelerator) continue;
    try {
      if (
        !globalShortcut.register(String(accelerator).slice(0, 80), () =>
          send("hotkey", action),
        )
      )
        failures.push(action);
    } catch {
      failures.push(action);
    }
  }
  return failures;
}
function trusted(event) {
  if (
    !win ||
    event.sender !== win.webContents ||
    event.senderFrame !== win.webContents.mainFrame
  )
    throw new Error("Invalid sender");
}
function handle(name, fn) {
  ipcMain.handle(name, async (event, ...args) => {
    trusted(event);
    return fn(...args);
  });
}
async function connect(invite, profile) {
  const next = new RoomClient();
  next.on("event", (event) => send("room-event", event));
  try {
    const result = await next.connect(invite, profile);
    client = next;
    return result;
  } catch (error) {
    next.close();
    throw error;
  }
}
function startApplicationAudio(sourceId) {
  stopAudio();
  const match = /^window:(\d+):\d+$/.exec(sourceId);
  if (!match) throw new Error("Выбери окно приложения для отдельного звука");
  if (!fs.existsSync(nativePath))
    throw new Error("Модуль звука не собран. Выполни npm run build:native.");
  return new Promise((resolve, reject) => {
    const proc = spawn(nativePath, ["--window", match[1]], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    captureProcess = proc;
    let ready = false,
      errorText = "",
      pending = Buffer.alloc(0);
    const timer = setTimeout(() => {
      if (!ready) {
        stopAudio();
        reject(new Error("Приложение не ответило на запрос захвата звука."));
      }
    }, 10000);
    proc.stderr.on("data", (data) => {
      errorText += data.toString();
      if (!ready && errorText.includes("READY")) {
        ready = true;
        clearTimeout(timer);
        resolve({ sampleRate: 48000, channels: 2 });
      }
    });
    proc.stdout.on("data", (data) => {
      pending = Buffer.concat([pending, data]);
      // Transfer complete stereo PCM frames; pipe writes may split at arbitrary bytes.
      const length = pending.length - (pending.length % 4);
      if (length) {
        send("app-audio", Uint8Array.from(pending.subarray(0, length)));
        pending = pending.subarray(length);
      }
    });
    proc.on("error", () => {
      clearTimeout(timer);
      if (!ready) reject(new Error("Не удалось запустить модуль звука."));
    });
    proc.on("exit", () => {
      clearTimeout(timer);
      const unexpected = captureProcess === proc;
      if (unexpected) captureProcess = null;
      if (!ready)
        reject(
          new Error(
            "Захват звука приложения недоступен: " +
              errorText.trim().slice(0, 160),
          ),
        );
      else if (unexpected)
        send("audio-ended", "Захват звука приложения завершился.");
    });
  });
}

app.whenReady().then(async () => {
  protocol.handle("pibble-app", (request) => {
    const url = new URL(request.url);
    const base = path.join(root, "dist");
    const target = path.resolve(
      base,
      "." +
        decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname),
    );
    if (url.host !== "club" || !target.startsWith(base + path.sep))
      return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(target).href);
  });
  session.defaultSession.setPermissionRequestHandler(
    (contents, permission, callback, details) =>
      callback(
        contents === win?.webContents &&
          details.requestingUrl?.startsWith("pibble-app://club/") &&
          ["media", "display-capture", "fullscreen"].includes(permission),
      ),
  );
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission, origin) =>
      contents === win?.webContents &&
      origin.startsWith("pibble-app://club") &&
      ["media", "display-capture", "fullscreen"].includes(permission),
  );
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      const choice = selectedCapture;
      selectedCapture = null;
      if (request.frame !== win?.webContents.mainFrame || !choice)
        return callback({});
      try {
        const sources = await desktopCapturer.getSources({
          types: ["window", "screen"],
          thumbnailSize: { width: 0, height: 0 },
        });
        const source = sources.find((s) => s.id === choice.id);
        if (!source) return callback({});
        callback({
          video: source,
          ...(choice.audio === "system" ? { audio: "loopback" } : {}),
        });
      } catch {
        callback({});
      }
    },
  );
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 670,
    title: "Prestera",
    icon: path.join(root, "dist", "pibble.png"),
    backgroundColor: "#17161b",
    show: !process.env.PIBBLE_TEST,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      webSecurity: true,
    },
  });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  handle("settings:get", () => ({
    ...settings,
    nativeAudio: fs.existsSync(nativePath),
    legacyWindowCapture,
    nativeVideo: fs.existsSync(
      path.join(root, "native", "bin", "prestera-gpu-video.exe"),
    ),
    version: app.getVersion(),
    pendingInvite,
    hotkeyFailures,
  }));
  handle("settings:set", (value) => {
    const allowed = {};
    for (const key of Object.keys(defaults))
      if (Object.hasOwn(value, key)) allowed[key] = value[key];
    if (allowed.serverUrl) allowed.serverUrl = relayUrl(allowed.serverUrl);
    if (Object.hasOwn(allowed, "serverKey"))
      allowed.serverKey = String(allowed.serverKey).slice(0, 256);
    if (
      Object.hasOwn(allowed, "connectionMode") &&
      !["direct", "vps"].includes(allowed.connectionMode)
    )
      throw new Error("Неверный режим подключения");
    if (Object.hasOwn(allowed, "forceRelay"))
      allowed.forceRelay = !!allowed.forceRelay;
    for (const [key, min, max] of [
      ["micGain", 0, 200],
      ["outputGain", 0, 100],
      ["soundGain", 0, 100],
      ["eventGain", 0, 100],
      ["musicGain", 0, 100],
      ["backgroundDim", 20, 95],
      ["gateThreshold", -80, -10],
      ["gateHold", 50, 1000],
      ["color", 0, 5],
    ]) {
      if (Object.hasOwn(allowed, key))
        allowed[key] = Number.isFinite(Number(allowed[key]))
          ? Math.min(max, Math.max(min, Number(allowed[key])))
          : defaults[key];
    }
    for (const [key, limit] of [
      ["avatar", 48000],
      ["banner", 60000],
      ["background", 1500000],
    ]) {
      if (
        Object.hasOwn(allowed, key) &&
        (typeof allowed[key] !== "string" ||
          allowed[key].length > limit ||
          (allowed[key] &&
            !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(
              allowed[key],
            )))
      )
        throw new Error("Некорректное изображение профиля");
    }
    if (
      Object.hasOwn(allowed, "accent") &&
      !/^#[a-fA-F0-9]{6}$/.test(allowed.accent)
    )
      throw new Error("Некорректный цвет");
    if (
      Object.hasOwn(allowed, "noiseMode") &&
      !["off", "standard", "voice"].includes(allowed.noiseMode)
    )
      throw new Error("Некорректный режим микрофона");
    for (const [key, max] of [
      ["statusText", 100],
      ["bio", 600],
    ])
      if (Object.hasOwn(allowed, key))
        allowed[key] = String(allowed[key] || "").slice(0, max);
    if (
      Object.hasOwn(allowed, "presence") &&
      !["online", "away", "busy", "offline"].includes(allowed.presence)
    )
      throw new Error("Некорректный статус");
    if (
      Object.hasOwn(allowed, "frame") &&
      ![
        "none",
        "signal",
        "fracture",
        "orbit",
        "thorn",
        "pixel",
        "ghost",
      ].includes(allowed.frame)
    )
      throw new Error("Некорректная рамка");
    if (
      Object.hasOwn(allowed, "profileColor") &&
      !/^#[a-f\d]{6}$/i.test(allowed.profileColor)
    )
      throw new Error("Некорректный цвет профиля");
    for (const key of ["eventSounds", "messageSounds", "captureBorder"])
      if (Object.hasOwn(allowed, key)) allowed[key] = !!allowed[key];
    if (
      Object.hasOwn(allowed, "captureMode") &&
      !["borderless", "compatible"].includes(allowed.captureMode)
    )
      throw new Error("Некорректный режим захвата");
    settings = {
      ...settings,
      ...allowed,
      name:
        String(value.name ?? settings.name)
          .trim()
          .slice(0, 32) || "Участник",
    };
    fs.writeFileSync(
      path.join(dataRoot, "settings.json.tmp"),
      JSON.stringify(settings, null, 2),
    );
    fs.renameSync(
      path.join(dataRoot, "settings.json.tmp"),
      path.join(dataRoot, "settings.json"),
    );
    return { failures: registerKeys(settings.hotkeys) };
  });
  handle("music:library", () => musicLibrary().snapshot());
  handle("music:update", (value) => musicLibrary().update(value));
  handle("music:add", async (id) => {
    const choice = await dialog.showOpenDialog(win, {
      title: "Добавить музыку в плейлист",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Аудио",
          extensions: [
            "mp3",
            "wav",
            "ogg",
            "opus",
            "m4a",
            "aac",
            "flac",
            "webm",
          ],
        },
      ],
    });
    return choice.canceled
      ? musicLibrary().snapshot()
      : musicLibrary().add(id, choice.filePaths);
  });
  handle("music:read", (id) => musicLibrary().read(id));
  handle(
    "room:host",
    async ({
      port,
      name,
      address,
      profile,
      connectionMode,
      serverUrl,
      serverKey,
    }) => {
      await leave();
      if (connectionMode === "vps") {
        try {
          host = await createRoom({ port: 0, name, loopback: true });
          const relayRoom = crypto.randomBytes(16).toString("hex");
          relayHost = await publishRoom(
            serverUrl,
            relayRoom,
            host.key,
            host.port,
            String(serverKey || ""),
          );
          host.setIceServers(relayHost.iceServers || []);
          const currentRelay = relayHost;
          relayHost.ws.on("close", () => {
            if (relayHost === currentRelay) {
              send("room-event", { type: "disconnected" });
              leave().catch(() => {});
            }
          });
          const result = await connect(
            inviteFor("127.0.0.1", host.port, host.key),
            profile,
          );
          return {
            ...result,
            hosting: true,
            connectionMode: "vps",
            invite: relayInvite(serverUrl, relayRoom, host.key),
            iceServers: relayHost.iceServers || [],
          };
        } catch (error) {
          await leave();
          throw error;
        }
      }
      host = await createRoom({ port: Number(port), name });
      try {
        const result = await connect(
          inviteFor("127.0.0.1", host.port, host.key),
          profile,
        );
        const advertised = address?.trim() || host.addresses[0] || "127.0.0.1";
        const invitation = inviteFor(advertised, host.port, host.key);
        parseInvite(invitation);
        return {
          ...result,
          hosting: true,
          invite: invitation,
          addresses: host.addresses,
          port: host.port,
          stunReady: host.stunReady,
        };
      } catch (error) {
        await leave();
        throw error;
      }
    },
  );
  handle("room:join", async ({ invite, profile }) => {
    await leave();
    return { ...(await connect(invite, profile)), invite, hosting: false };
  });
  handle("room:leave", leave);
  handle("video:start", async (choice) => {
    if (
      !selectedCapture ||
      selectedCapture.id !== choice.id ||
      !/^window:\d+:\d+$/.test(choice.id) ||
      !["dwm", "wgc", "gdi"].includes(choice.backend) ||
      !/^[a-f0-9-]{36}$/.test(choice.token)
    )
      throw new Error("Сначала выбери окно");
    selectedCapture = null;
    const number = (v, min, max, fallback) =>
      Number.isFinite(Number(v))
        ? Math.min(max, Math.max(min, Math.round(Number(v))))
        : fallback;
    return windowVideo.start(
      {
        id: choice.id,
        token: choice.token,
        backend: choice.backend,
        width: number(choice.width, 320, 1920, 1920),
        height: number(choice.height, 240, 1080, 1080),
        fps: number(choice.fps, 1, 60, 30),
      },
      false,
    );
  });
  handle("video:stop", () => windowVideo.stop());
  handle("spotify:open", async (value) => {
    const url = new URL(String(value));
    if (
      url.protocol !== "https:" ||
      url.hostname !== "open.spotify.com" ||
      url.port ||
      url.username ||
      url.password ||
      !/^\/(track|playlist|album|artist)\/[a-zA-Z0-9]{22}$/.test(url.pathname)
    )
      throw new Error("Нужна ссылка Spotify");
    await shell.openExternal(url.href);
  });
  handle("room:signal", (payload) => {
    if (payload?.type !== "signal") throw new Error("Invalid signal");
    client?.send(payload);
  });
  handle("clipboard:write", (text) =>
    clipboard.writeText(String(text).slice(0, 4096)),
  );
  handle("capture:sources", async () =>
    (
      await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true,
      })
    )
      .filter((s) =>
        process.env.PIBBLE_TEST
          ? s.name === "Pibble capture test"
          : !s.name.startsWith("Prestera"),
      )
      .map((s) => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
        icon: s.appIcon?.toDataURL(),
      })),
  );
  handle("capture:select", (choice) => {
    if (
      !/^(window|screen):/.test(choice.id) ||
      !["none", "system", "app", "device"].includes(choice.audio)
    )
      throw new Error("Invalid source");
    selectedCapture = { id: choice.id, audio: choice.audio };
  });
  handle("audio:start", startApplicationAudio);
  handle("audio:stop", stopAudio);
  handle("file:save", async ({ name, data }) => {
    if (!(data instanceof Uint8Array) || data.length > 32 * 1024 * 1024)
      throw new Error("Файл слишком большой");
    const result = await dialog.showSaveDialog(win, {
      defaultPath: path
        .basename(String(name))
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_"),
    });
    if (!result.canceled) await fs.promises.writeFile(result.filePath, data);
    return !result.canceled;
  });
  handle("window:action", (action) => {
    if (action === "minimize") win.minimize();
  });
  handle("protocol:register", () =>
    app.setAsDefaultProtocolClient(
      "prestera",
      process.execPath,
      app.isPackaged ? [] : [root],
    ),
  );
  hotkeyFailures = registerKeys(settings.hotkeys);
  const initialInvite = process.argv.find((arg) =>
    /^(pibble|prestera):\/\//.test(arg),
  );
  if (initialInvite) pendingInvite = initialInvite;
  await win.loadURL("pibble-app://club/index.html");
});
app.on("window-all-closed", () => app.quit());
app.on("second-instance", (event, args) => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
  const invite = args.find((arg) => /^(pibble|prestera):\/\//.test(arg));
  if (invite) {
    pendingInvite = invite;
    send("invite", invite);
  }
});
app.on("before-quit", () => {
  relayHost?.close();
  windowVideo.stop();
  globalShortcut.unregisterAll();
  stopAudio();
  client?.close();
  host?.close();
});
app.on("open-url", (event, url) => {
  event.preventDefault();
  if (/^(pibble|prestera):\/\//.test(url)) {
    pendingInvite = url;
    send("invite", url);
  }
});
