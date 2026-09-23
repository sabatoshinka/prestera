const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

// Copy the complete Electron profile (including IndexedDB), without modifying
// the portable original. Publish only a complete copy; never merge two profiles.
function prepareDataRoot({ override, packaged, root, appData, executable }) {
  if (override || !packaged) {
    const directory = override || path.join(root, ".cache", "profile");
    fs.mkdirSync(directory, { recursive: true });
    return directory;
  }
  // Electron may create its default app-data folder before our entrypoint.
  // Keep the migrated profile below it, so an empty default folder cannot
  // accidentally suppress the first migration.
  const container = path.join(appData, "Prestera");
  const directory = path.join(container, "Profile");
  if (fs.existsSync(directory)) return directory;
  const legacy = findLegacy(executable);
  fs.mkdirSync(container, { recursive: true });
  const staging = path.join(container, `migration-${randomUUID()}`);
  try {
    if (legacy) {
      fs.cpSync(legacy, staging, {
        recursive: true,
        filter: (source) => {
          if (fs.lstatSync(source).isSymbolicLink())
            throw new Error("Profile contains a symbolic link: " + source);
          return ![
            "SingletonLock",
            "SingletonCookie",
            "SingletonSocket",
          ].includes(path.basename(source));
        },
      });
    } else fs.mkdirSync(staging);
    // A concurrent launch may already have completed the migration.
    if (!fs.existsSync(directory)) fs.renameSync(staging, directory);
  } finally {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true });
  }
  return directory;
}

function findLegacy(executable) {
  const beside = path.join(path.dirname(executable), "PibbleData");
  if (fs.existsSync(beside)) return beside;
  // A fresh archive is commonly extracted beside the previous release.
  // Only inspect Prestera/Pibble release folders, never arbitrary user folders.
  const parent = path.dirname(path.dirname(executable));
  const candidates = [];
  for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      !/^(Prestera|Pibble-Club)-\d+\.\d+\.\d+-win-x64$/.test(entry.name)
    )
      continue;
    const directory = path.join(parent, entry.name, "PibbleData");
    try {
      const stat = fs.statSync(path.join(directory, "settings.json"));
      if (stat.isFile()) candidates.push({ directory, modified: stat.mtimeMs });
    } catch {
      /* An unused release has no profile. */
    }
  }
  candidates.sort((a, b) => b.modified - a.modified);
  return candidates[0]?.directory || null;
}

module.exports = { prepareDataRoot, findLegacy };
