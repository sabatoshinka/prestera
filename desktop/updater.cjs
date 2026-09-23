const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);
const REPO = "sabatoshinka/prestera";
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const MAX_DOWNLOAD = 600 * 1024 * 1024;

function versionParts(value) {
  if (
    typeof value !== "string" ||
    !/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
  )
    throw new Error("Некорректная версия релиза");
  const parts = value.replace(/^v/, "").split(".").map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part)))
    throw new Error("Некорректная версия релиза");
  return parts;
}
function isNewer(candidate, current) {
  const a = versionParts(candidate),
    b = versionParts(current);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function releaseInfo(release, current) {
  if (release.draft || release.prerelease)
    throw new Error("Нужен стабильный релиз");
  const version = versionParts(release.tag_name).join(".");
  if (!isNewer(version, current)) return null;
  const name = `Prestera-${version}-win-x64.zip`;
  const asset = release.assets?.find((item) => item.name === name);
  const expected = `https://github.com/${REPO}/releases/download/${release.tag_name}/${name}`;
  if (
    !asset ||
    asset.state !== "uploaded" ||
    asset.browser_download_url !== expected ||
    !Number.isSafeInteger(asset.size) ||
    asset.size < 1 ||
    asset.size > MAX_DOWNLOAD ||
    !/^sha256:[a-f0-9]{64}$/.test(asset.digest || "")
  )
    throw new Error(
      "В релизе нет готового Windows-архива с контрольной суммой SHA-256",
    );
  return {
    version,
    name,
    size: asset.size,
    sha256: asset.digest.slice(7),
    url: expected,
  };
}
function trustedUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    ![
      "api.github.com",
      "github.com",
      "release-assets.githubusercontent.com",
      "objects.githubusercontent.com",
    ].includes(url.hostname)
  )
    throw new Error("Недопустимый адрес обновления");
  return url.href;
}
async function responseFrom(fetcher, url, signal) {
  for (let redirects = 0; redirects < 6; redirects++) {
    const response = await fetcher(trustedUrl(url), {
      redirect: "manual",
      signal,
      cache: "no-store",
      credentials: "omit",
      headers: {
        "User-Agent": "Prestera-Updater",
        Accept: "application/octet-stream, application/json",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("GitHub вернул пустое перенаправление");
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 403 || response.status === 429)
        throw new Error("GitHub временно ограничил запросы. Попробуй позже.");
      throw new Error(`GitHub: HTTP ${response.status}`);
    }
    return response;
  }
  throw new Error("Слишком много перенаправлений GitHub");
}
async function readLimited(response, max) {
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) throw new Error("Ответ GitHub слишком большой");
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => {});
  }
}
async function downloadArchive(fetcher, release, file, signal, progress) {
  const response = await responseFrom(fetcher, release.url, signal);
  const reader = response.body.getReader();
  const hash = createHash("sha256");
  const output = await fs.promises.open(file, "wx");
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > release.size)
        throw new Error("Размер архива не совпадает с релизом");
      hash.update(value);
      // FileHandle.write is allowed to perform a partial write.
      for (let offset = 0; offset < value.length; ) {
        const { bytesWritten } = await output.write(
          value,
          offset,
          value.length - offset,
        );
        if (!bytesWritten) throw new Error("Не удалось записать обновление");
        offset += bytesWritten;
      }
      progress(received, release.size);
    }
    if (received !== release.size || hash.digest("hex") !== release.sha256)
      throw new Error(
        "Проверка SHA-256 не пройдена. Скачай обновление повторно.",
      );
    await output.sync();
  } finally {
    await output.close();
    await reader.cancel().catch(() => {});
  }
}
function installedExecutable(base, version, directory) {
  versionParts(version);
  // Paths in the local pointer can only select a managed version directory.
  if (
    typeof directory !== "string" ||
    !/^install-[a-zA-Z0-9]+$/.test(directory)
  )
    throw new Error("Некорректная папка обновления");
  const install = path.join(base, directory, `Prestera-${version}-win-x64`);
  const pkg = JSON.parse(
    fs.readFileSync(
      path.join(install, "resources", "app", "package.json"),
      "utf8",
    ),
  );
  if (
    pkg.name !== "prestera" ||
    pkg.version !== version ||
    pkg.main !== "desktop/main.cjs"
  )
    throw new Error("Архив содержит другую версию приложения");
  for (const file of [
    "Prestera.exe",
    "resources/app/desktop/main.cjs",
    "resources/app/dist/index.html",
    "resources/app/dist/main.js",
    "resources/app/native/bin/prestera-gpu-video.exe",
    "resources/app/native/bin/pibble-audio.exe",
  ])
    if (!fs.statSync(path.join(install, file)).isFile())
      throw new Error("Неполный архив обновления");
  return path.join(install, "Prestera.exe");
}
function getInstalled(base, current) {
  try {
    const pointer = JSON.parse(
      fs.readFileSync(path.join(base, "current.json"), "utf8"),
    );
    if (isNewer(pointer.version, current))
      return installedExecutable(base, pointer.version, pointer.directory);
  } catch {
    /* A missing/broken update must not prevent the old app starting. */
  }
  return null;
}

class Updater {
  constructor({ version, enabled, base, fetcher, notify, extract }) {
    Object.assign(this, { version, enabled, base, fetcher, notify });
    this.extract =
      extract ||
      (async (archive, destination, release) => {
        await run(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            path.join(__dirname, "extract-update.ps1"),
            "-Archive",
            archive,
            "-Destination",
            destination,
            "-Version",
            release.version,
            "-ExpectedHash",
            release.sha256,
          ],
          { windowsHide: true, timeout: 180000, maxBuffer: 1024 * 1024 },
        );
      });
    this.state = { status: "idle", currentVersion: version, enabled };
  }
  set(value) {
    Object.assign(this.state, value);
    this.notify({ ...this.state });
  }
  snapshot() {
    return { ...this.state };
  }
  async check() {
    if (this.busy || this.state.status === "ready") return this.snapshot();
    this.busy = true;
    this.set({
      status: "checking",
      error: "",
      version: null,
      received: 0,
      total: 0,
    });
    try {
      const response = await responseFrom(
        this.fetcher,
        API,
        AbortSignal.timeout(20000),
      );
      const release = JSON.parse(
        (await readLimited(response, 2 * 1024 * 1024)).toString("utf8"),
      );
      this.release = releaseInfo(release, this.version);
      this.set({
        status: this.release ? "available" : "current",
        version: this.release?.version || null,
      });
    } catch (error) {
      this.set({ status: "error", error: error.message });
    } finally {
      this.busy = false;
    }
    return this.snapshot();
  }
  cancel() {
    this.controller?.abort();
  }
  async download() {
    if (!this.enabled)
      throw new Error("Установка обновлений доступна в готовой Windows-версии");
    if (this.busy || this.state.status === "ready") return this.snapshot();
    if (!this.release) throw new Error("Сначала проверь обновления");
    this.busy = true;
    this.controller = new AbortController();
    const signal = AbortSignal.any([
      this.controller.signal,
      AbortSignal.timeout(20 * 60 * 1000),
    ]);
    let archive, destination;
    this.set({
      status: "downloading",
      error: "",
      received: 0,
      total: this.release.size,
    });
    try {
      await fs.promises.mkdir(this.base, { recursive: true });
      destination = await fs.promises.mkdtemp(path.join(this.base, "install-"));
      archive = path.join(destination, "download.zip");
      let last = 0;
      await downloadArchive(
        this.fetcher,
        this.release,
        archive,
        signal,
        (received, total) => {
          if (Date.now() - last > 200 || received === total) {
            this.set({ received, total });
            last = Date.now();
          }
        },
      );
      signal.throwIfAborted();
      this.set({ status: "extracting" });
      await this.extract(archive, destination, this.release);
      signal.throwIfAborted();
      this.ready = {
        version: this.release.version,
        directory: path.basename(destination),
      };
      installedExecutable(this.base, this.ready.version, this.ready.directory);
      await fs.promises.unlink(archive);
      this.set({ status: "ready" });
    } catch (error) {
      this.ready = null;
      // Only this newly-created staging directory is ever removed.
      if (destination) {
        const absolute = path.resolve(destination);
        if (
          path.dirname(absolute) === path.resolve(this.base) &&
          /^install-[a-zA-Z0-9]+$/.test(path.basename(absolute))
        )
          await fs.promises
            .rm(absolute, { recursive: true, force: true })
            .catch(() => {});
      }
      this.set({
        status: this.controller.signal.aborted ? "available" : "error",
        error: this.controller.signal.aborted ? "" : error.message,
      });
    } finally {
      this.controller = null;
      this.busy = false;
    }
    return this.snapshot();
  }
  activate() {
    if (
      !this.enabled ||
      this.busy ||
      this.state.status !== "ready" ||
      !this.ready
    )
      throw new Error("Обновление ещё не готово");
    const executable = installedExecutable(
      this.base,
      this.ready.version,
      this.ready.directory,
    );
    const file = path.join(this.base, "current.json");
    fs.writeFileSync(file + ".tmp", JSON.stringify(this.ready));
    fs.renameSync(file + ".tmp", file);
    return executable;
  }
}
module.exports = {
  Updater,
  isNewer,
  releaseInfo,
  trustedUrl,
  responseFrom,
  downloadArchive,
  getInstalled,
  installedExecutable,
};
