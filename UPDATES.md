# Updating Prestera

## For users

From version 0.7.0, use **Settings → Updates** to check GitHub, download a release, and restart. You can cancel a download or keep using the current version until you are ready. Leave the room before restarting. Startup checks can be disabled; downloads require a click.

The first upgrade from 0.6.x is manual. Close the old app and extract 0.7.0 beside the previous release folder. The first launch copies `PibbleData` next to the new executable, or the most recently modified profile in a neighboring `Prestera-<version>-win-x64` / `Pibble-Club-<version>-win-x64` folder. If your old release is elsewhere, copy its `PibbleData` beside the new executable **before the first launch**.

Data is shared by newer builds at `%APPDATA%\Prestera\Profile`. Migration copies the entire Electron profile, including IndexedDB chat history and sound clips, local storage, settings, and playlist metadata. It leaves the original intact and never merges or overwrites an existing shared profile. Local music files stay at their original paths.

Updates are extracted under `%LOCALAPPDATA%\Prestera\versions` into a separate directory. The old app remains intact. Launching an older build with updater support forwards to the activated newer build. Shortcuts pointing to builds before 0.7.0 must be changed manually once.

If GitHub is unavailable or rate-limits requests, the current app keeps working and shows an error when checking or downloading. A failed download can be retried; partial downloads are not resumed. There is no separate Prestera update server.

## Publishing a compatible release

1. Bump `package.json` and the root version in `package-lock.json` to a stable `major.minor.patch` version.
2. Build the native helpers if changed, then run `npm run package`.
3. Add `CHANGES.txt` and `VALIDATION.md` to the packaged folder and run `scripts/archive.ps1`.
4. Publish a GitHub release in `sabatoshinka/prestera`, tagged `v<version>`, with the exact asset name `Prestera-<version>-win-x64.zip`. Its top-level folder must be `Prestera-<version>-win-x64`.
5. Ensure it is the latest stable release and its asset metadata has a `sha256:` digest. Upload the generated `.sha256` alongside the ZIP for manual downloads too.

The updater uses the [GitHub Releases API](https://docs.github.com/en/rest/releases/releases) and verifies the [asset digest](https://docs.github.com/en/rest/releases/assets), byte count, archive paths, and packaged version before activation. It accepts only HTTPS to GitHub and its release asset hosts. There are size limits and network timeouts. This verifies download integrity; it is not an independent signature protecting against a compromised release account.

Restart uses [Electron's `app.relaunch`](https://www.electronjs.org/docs/latest/api/app#apprelaunchoptions). The updater does not require administrator privileges, replace the running executable, or delete earlier versions. To recover manually from a faulty newer build, close Prestera, rename `%LOCALAPPDATA%\Prestera\versions\current.json`, and launch the previous build. Keep the profile backed up before rolling back across future data format changes.

Development runs and instances with `PIBBLE_TEST` or `PIBBLE_DATA_DIR` cannot install updates. Tests use fixture releases and isolated profiles; they do not publish or execute downloaded release files.
