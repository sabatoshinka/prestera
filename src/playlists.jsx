import React, { useEffect, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  FolderPlus,
  ListMusic,
  Play,
} from "lucide-react";
import { IconButton } from "./ui";
const bridge = window.pibble;
export function PlaylistLibrary({ engine, notify }) {
  const [library, setLibrary] = useState({ playlists: [], selected: "" });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const selected = library.playlists.find((p) => p.id === library.selected);
  useEffect(() => {
    bridge
      .musicLibrary()
      .then(setLibrary)
      .catch((e) => notify(e.message));
  }, []);
  const action = async (task) => {
    setBusy(true);
    try {
      setLibrary(await task());
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="playlist-library" aria-label="Сохранённые плейлисты">
      <label className="field">
        <span>Мои плейлисты</span>
        <select
          aria-label="Выбрать плейлист"
          value={library.selected}
          disabled={busy}
          onChange={(e) => {
            setDeleting(false);
            action(() =>
              bridge.updatePlaylist({ action: "select", id: e.target.value }),
            );
          }}
        >
          <option value="" disabled>
            Выбери или создай плейлист
          </option>
          {library.playlists.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.tracks.length}
            </option>
          ))}
        </select>
      </label>
      <div className="playlist-actions">
        <input
          aria-label="Название плейлиста"
          placeholder="Название плейлиста"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <IconButton
          icon={Plus}
          label="Создать плейлист"
          disabled={busy || !name.trim()}
          onClick={() =>
            action(() => bridge.updatePlaylist({ action: "create", name }))
          }
        />
        <IconButton
          icon={Pencil}
          label="Переименовать плейлист"
          disabled={busy || !selected || !name.trim()}
          onClick={() =>
            action(() =>
              bridge.updatePlaylist({
                action: "rename",
                id: selected.id,
                name,
              }),
            )
          }
        />
        <IconButton
          icon={Trash2}
          label="Удалить плейлист"
          disabled={busy || !selected}
          onClick={() => setDeleting((v) => !v)}
        />
      </div>
      {deleting && selected && (
        <div className="playlist-actions">
          <span>Удалить «{selected.name}»? Файлы останутся.</span>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => {
              action(() =>
                bridge.updatePlaylist({ action: "delete", id: selected.id }),
              );
              setDeleting(false);
            }}
          >
            Удалить
          </button>
        </div>
      )}
      {selected && (
        <>
          <div className="playlist-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => action(() => bridge.addPlaylistFiles(selected.id))}
            >
              <FolderPlus size={16} /> Добавить файлы
            </button>
            <button
              className="button secondary"
              disabled={!selected.tracks.length}
              onClick={() => {
                engine.musicLoadPlaylist(selected);
                notify(`В очереди: ${selected.name}`);
              }}
            >
              <ListMusic size={16} /> В очередь
            </button>
          </div>
          <div className="playlist-tracks">
            {selected.tracks.map((t) => (
              <div key={t.id}>
                <span title={t.name}>
                  {t.name}
                  {t.missing && <small> · файл не найден</small>}
                </span>
                <IconButton
                  icon={Trash2}
                  label={`Удалить из плейлиста ${t.name}`}
                  disabled={busy}
                  onClick={() =>
                    action(() =>
                      bridge.updatePlaylist({
                        action: "remove",
                        id: selected.id,
                        track: t.id,
                      }),
                    )
                  }
                />
              </div>
            ))}
          </div>
        </>
      )}
      <p className="notice">
        Плейлисты сохраняются на этом компьютере. Аудиофайлы остаются на своих
        местах — после перемещения добавь их заново. Кнопка «В очередь» заменяет
        текущую очередь.
      </p>
    </section>
  );
}
