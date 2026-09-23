const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const {
  Updater,
  isNewer,
  releaseInfo,
  trustedUrl,
  responseFrom,
  downloadArchive,
  getInstalled,
} = require("../desktop/updater.cjs");
const { prepareDataRoot } = require("../desktop/data-root.cjs");
const payload = Buffer.from("release archive fixture");
const digest = createHash("sha256").update(payload).digest("hex");
const metadata = () => ({
  tag_name: "v0.8.0",
  draft: false,
  prerelease: false,
  assets: [
    {
      name: "Prestera-0.8.0-win-x64.zip",
      state: "uploaded",
      size: payload.length,
      digest: "sha256:" + digest,
      browser_download_url:
        "https://github.com/sabatoshinka/prestera/releases/download/v0.8.0/Prestera-0.8.0-win-x64.zip",
    },
  ],
});
function temporary(t) {
  const base = path.resolve(".cache", "updater-tests");
  fs.mkdirSync(base, { recursive: true });
  const directory = fs.mkdtempSync(path.join(base, "case-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), base);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
function put(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

test("stable version comparison and release validation reject downgrade, wrong asset and missing digest", () => {
  assert.equal(isNewer("0.10.0", "0.9.9"), true);
  assert.equal(isNewer("v1.0.0", "1.0.0"), false);
  assert.equal(isNewer("0.7.99", "0.8.0"), false);
  for (const version of [
    "0.8.0-beta.1",
    "../0.8.0",
    "0.08.0",
    "99999999999999999999.0.0",
  ])
    assert.throws(() => isNewer(version, "0.7.0"));
  assert.equal(releaseInfo(metadata(), "0.8.0"), null);
  assert.equal(releaseInfo(metadata(), "0.7.0").sha256, digest);
  for (const change of [
    (r) => (r.draft = true),
    (r) => (r.prerelease = true),
    (r) => (r.assets[0].digest = null),
    (r) => (r.assets[0].browser_download_url = "https://example.com/file.zip"),
    (r) => (r.assets[0].size = 700 * 1024 * 1024),
  ]) {
    const value = metadata();
    change(value);
    assert.throws(() => releaseInfo(value, "0.7.0"));
  }
});
test("updater refuses untrusted protocols and redirect destinations before fetching them", async () => {
  for (const url of [
    "http://github.com/a",
    "https://github.com.evil.test/a",
    "file:///C:/a",
    "https://a@github.com/a",
    "https://github.com:444/a",
  ])
    assert.throws(() => trustedUrl(url));
  let calls = 0;
  await assert.rejects(
    responseFrom(
      async () => {
        calls++;
        return new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/private" },
        });
      },
      "https://github.com/asset",
      AbortSignal.timeout(1000),
    ),
    /адрес/,
  );
  assert.equal(calls, 1);
});
test("download validates both actual length and SHA-256; truncated or modified bytes cannot install", async (t) => {
  const directory = temporary(t),
    release = releaseInfo(metadata(), "0.7.0");
  const file = path.join(directory, "good.zip");
  await downloadArchive(
    async () => new Response(payload),
    release,
    file,
    AbortSignal.timeout(1000),
    () => {},
  );
  assert.deepEqual(fs.readFileSync(file), payload);
  let count = 0;
  for (const body of [
    payload.subarray(1),
    Buffer.alloc(payload.length),
    Buffer.concat([payload, payload]),
  ])
    await assert.rejects(
      downloadArchive(
        async () => new Response(body),
        release,
        path.join(directory, `bad${count++}.zip`),
        AbortSignal.timeout(1000),
        () => {},
      ),
    );
});
test("complete update stages independently; activation selects only a validated newer app", async (t) => {
  const base = temporary(t);
  const states = [];
  const updater = new Updater({
    version: "0.7.0",
    enabled: true,
    base,
    notify: (s) => states.push(s.status),
    fetcher: async (url) =>
      new Response(
        url.includes("api.github.com") ? JSON.stringify(metadata()) : payload,
      ),
    extract: async (_, destination, release) => {
      const root = path.join(
        destination,
        `Prestera-${release.version}-win-x64`,
      );
      put(
        path.join(root, "resources/app/package.json"),
        JSON.stringify({
          name: "prestera",
          version: release.version,
          main: "desktop/main.cjs",
        }),
      );
      for (const file of [
        "Prestera.exe",
        "resources/app/desktop/main.cjs",
        "resources/app/dist/index.html",
        "resources/app/dist/main.js",
        "resources/app/native/bin/prestera-gpu-video.exe",
        "resources/app/native/bin/pibble-audio.exe",
      ])
        put(path.join(root, file), "fixture");
    },
  });
  assert.throws(() => updater.activate());
  await updater.check();
  assert.equal(updater.snapshot().status, "available");
  await updater.download();
  assert.equal(updater.snapshot().status, "ready");
  assert.equal(fs.existsSync(path.join(base, "current.json")), false);
  const executable = updater.activate();
  assert.equal(getInstalled(base, "0.7.0"), executable);
  assert.equal(getInstalled(base, "0.8.0"), null);
  assert.equal(getInstalled(base, "0.9.0"), null);
  assert.deepEqual(states, [
    "checking",
    "available",
    "downloading",
    "downloading",
    "extracting",
    "ready",
  ]);
  put(
    path.join(base, "current.json"),
    JSON.stringify({ version: "9.0.0", directory: "../../outside" }),
  );
  assert.equal(getInstalled(base, "0.7.0"), null);
});
test("bad download leaves active version and other installs intact; no extraction occurs", async (t) => {
  const base = temporary(t);
  put(path.join(base, "current.json"), "unchanged");
  put(path.join(base, "install-old", "keep"), "old app");
  let extracted = false;
  const updater = new Updater({
    version: "0.7.0",
    enabled: true,
    base,
    notify: () => {},
    fetcher: async (url) =>
      new Response(
        url.includes("api.github.com")
          ? JSON.stringify(metadata())
          : Buffer.alloc(payload.length),
      ),
    extract: async () => {
      extracted = true;
    },
  });
  await updater.check();
  await updater.download();
  assert.equal(extracted, false);
  assert.equal(updater.snapshot().status, "error");
  assert.throws(() => updater.activate());
  assert.equal(
    fs.readFileSync(path.join(base, "current.json"), "utf8"),
    "unchanged",
  );
  assert.deepEqual(fs.readdirSync(base).sort(), [
    "current.json",
    "install-old",
  ]);
});
test("cancelled download can be retried without losing a previous installation", async (t) => {
  const base = temporary(t);
  let downloading;
  const started = new Promise((resolve) => (downloading = resolve));
  const updater = new Updater({
    version: "0.7.0",
    enabled: true,
    base,
    notify: () => {},
    fetcher: async (url, { signal }) => {
      if (url.includes("api.github.com"))
        return new Response(JSON.stringify(metadata()));
      downloading();
      return new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      );
    },
  });
  await updater.check();
  const pending = updater.download();
  await started;
  updater.cancel();
  await pending;
  assert.equal(updater.snapshot().status, "available");
  assert.deepEqual(fs.readdirSync(base), []);
});
test("profile migration copies IndexedDB, local storage and playlists once and preserves the portable original", (t) => {
  const base = temporary(t),
    executable = path.join(base, "portable", "Prestera.exe");
  const legacy = path.join(base, "portable", "PibbleData");
  for (const file of [
    "settings.json",
    "playlists.json",
    "IndexedDB/example/blob",
    "Local Storage/leveldb/0001.ldb",
  ])
    put(path.join(legacy, file), `original ${file}`);
  const args = {
    packaged: true,
    root: base,
    appData: path.join(base, "Roaming"),
    executable,
  };
  const directory = prepareDataRoot(args);
  assert.equal(directory, path.join(base, "Roaming", "Prestera", "Profile"));
  assert.equal(
    fs.readFileSync(path.join(directory, "IndexedDB/example/blob"), "utf8"),
    "original IndexedDB/example/blob",
  );
  put(path.join(directory, "settings.json"), "new settings");
  assert.equal(prepareDataRoot(args), directory);
  assert.equal(
    fs.readFileSync(path.join(directory, "settings.json"), "utf8"),
    "new settings",
  );
  assert.equal(
    fs.readFileSync(path.join(legacy, "settings.json"), "utf8"),
    "original settings.json",
  );
});
test("first manual upgrade finds the most recently used neighboring release; development stays isolated", (t) => {
  const base = temporary(t),
    executable = path.join(base, "Prestera-0.7.0-win-x64", "Prestera.exe");
  const older = path.join(
    base,
    "Prestera-0.6.2-win-x64",
    "PibbleData",
    "settings.json",
  );
  put(older, "older");
  fs.utimesSync(older, 1, 1);
  put(
    path.join(base, "Prestera-0.6.3-win-x64", "PibbleData", "settings.json"),
    "latest profile",
  );
  put(
    path.join(base, "unrelated", "PibbleData", "settings.json"),
    "do not use",
  );
  const args = {
    packaged: true,
    root: base,
    appData: path.join(base, "Roaming"),
    executable,
  };
  const directory = prepareDataRoot(args);
  assert.equal(
    fs.readFileSync(path.join(directory, "settings.json"), "utf8"),
    "latest profile",
  );
  assert.equal(
    prepareDataRoot({ ...args, packaged: false }),
    path.join(base, ".cache", "profile"),
  );
  assert.equal(
    prepareDataRoot({ ...args, override: path.join(base, "test-profile") }),
    path.join(base, "test-profile"),
  );
});

test(
  "Windows extraction accepts valid archives and blocks traversal, ADS and Windows aliases",
  { skip: process.platform !== "win32", timeout: 30000 },
  (t) => {
    const base = temporary(t);
    const fixtureScript = path.resolve("tests", "update-zip-fixture.ps1");
    for (const [index, name] of [
      "Prestera-0.8.0-win-x64/resources/test.txt",
      "Prestera-0.8.0-win-x64/../../escaped.txt",
      "Prestera-0.8.0-win-x64/data:evil",
      "Prestera-0.8.0-win-x64/CON.txt",
      "Prestera-0.8.0-win-x64/dot. /file",
    ].entries()) {
      const archive = path.join(base, `case-${index}.zip`),
        destination = path.join(base, `out-${index}`);
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          fixtureScript,
          "-Archive",
          archive,
          "-EntryName",
          name,
        ],
        { windowsHide: true },
      );
      const sha = createHash("sha256")
        .update(fs.readFileSync(archive))
        .digest("hex");
      const extract = () =>
        execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            path.resolve("desktop/extract-update.ps1"),
            "-Archive",
            archive,
            "-Destination",
            destination,
            "-Version",
            "0.8.0",
            "-ExpectedHash",
            sha,
          ],
          { windowsHide: true, stdio: "pipe" },
        );
      if (index === 0) {
        extract();
        assert.equal(
          fs.readFileSync(path.join(destination, name), "utf8"),
          "test",
        );
      } else {
        assert.throws(extract);
        assert.equal(fs.existsSync(destination), false);
      }
    }
    assert.equal(fs.existsSync(path.join(base, "escaped.txt")), false);
  },
);
