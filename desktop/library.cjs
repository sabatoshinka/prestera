const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const AUDIO = /\.(mp3|wav|ogg|opus|m4a|aac|flac|webm)$/i;
class MusicLibrary {
  constructor(directory) {
    this.file = path.join(directory, "playlists.json");
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error("Не удалось прочитать playlists.json");
      this.data = { version: 1, selected: "", playlists: [] };
    }
    if (!Array.isArray(this.data.playlists))
      throw new Error("Некорректный playlists.json");
  }
  snapshot() {
    return {
      ...this.data,
      playlists: this.data.playlists.map((p) => ({
        ...p,
        tracks: p.tracks.map(({ path: filename, ...t }) => ({
          ...t,
          missing: !fs.existsSync(filename),
        })),
      })),
    };
  }
  save() {
    fs.writeFileSync(this.file + ".tmp", JSON.stringify(this.data, null, 2));
    fs.renameSync(this.file + ".tmp", this.file);
    return this.snapshot();
  }
  update({ action, id, name, track }) {
    const p = this.data.playlists.find((p) => p.id === id);
    if (action === "create") {
      if (this.data.playlists.length >= 100)
        throw new Error("Максимум 100 плейлистов");
      const item = {
        id: randomUUID(),
        name:
          String(name || "")
            .trim()
            .slice(0, 80) || "Новый плейлист",
        tracks: [],
      };
      this.data.playlists.push(item);
      this.data.selected = item.id;
    } else {
      if (!p) throw new Error("Плейлист не найден");
      if (action === "select") this.data.selected = id;
      else if (action === "rename")
        p.name =
          String(name || "")
            .trim()
            .slice(0, 80) || p.name;
      else if (action === "delete") {
        this.data.playlists = this.data.playlists.filter((p) => p.id !== id);
        if (this.data.selected === id)
          this.data.selected = this.data.playlists[0]?.id || "";
      } else if (action === "remove")
        p.tracks = p.tracks.filter((t) => t.id !== track);
      else throw new Error("Неизвестное действие");
    }
    return this.save();
  }
  add(id, files) {
    const p = this.data.playlists.find((p) => p.id === id);
    if (!p) throw new Error("Выбери плейлист");
    const unique = [...new Set(files)].filter(
      (f) => !p.tracks.some((t) => t.path === f),
    );
    if (p.tracks.length + unique.length > 50)
      throw new Error("Максимум 50 треков в плейлисте");
    const tracks = unique.map((filename) => {
      const stat = fs.statSync(filename);
      if (
        !AUDIO.test(filename) ||
        !stat.isFile() ||
        stat.size > 100 * 1024 * 1024
      )
        throw new Error("Нужны аудиофайлы до 100 МБ");
      return {
        id: randomUUID(),
        name: path.basename(filename, path.extname(filename)),
        path: path.resolve(filename),
      };
    });
    p.tracks.push(...tracks);
    return this.save();
  }
  async read(id) {
    const track = this.data.playlists
      .flatMap((p) => p.tracks)
      .find((t) => t.id === id);
    if (!track) throw new Error("Трек больше не находится в плейлисте");
    let handle;
    try {
      handle = await fs.promises.open(track.path, "r");
      const stat = await handle.stat();
      if (
        !AUDIO.test(track.path) ||
        !stat.isFile() ||
        stat.size > 100 * 1024 * 1024
      )
        throw new Error("Invalid audio");
      const bytes = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(
          bytes,
          offset,
          bytes.length - offset,
          offset,
        );
        if (!bytesRead) break;
        offset += bytesRead;
      }
      return bytes.subarray(0, offset);
    } catch {
      throw new Error(
        `Не удалось открыть «${track.name}». Если файл перемещён, добавь его заново.`,
      );
    } finally {
      await handle?.close();
    }
  }
}
module.exports = { MusicLibrary };
