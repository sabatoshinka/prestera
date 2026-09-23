import React, { useEffect, useState } from "react";
import { Download, RefreshCw, FolderOpen } from "lucide-react";
import { Toggle } from "./ui";
const bridge = window.pibble;

export function useUpdates() {
  const [state, setState] = useState({ status: "idle" });
  useEffect(() => {
    let active = true;
    const stop = bridge.onUpdate((value) => active && setState(value));
    bridge
      .updateState()
      .then((value) => active && setState(value))
      .catch(() => {});
    return () => {
      active = false;
      stop();
    };
  }, []);
  return state;
}

export function UpdatesPanel({ draft, set, notify }) {
  const state = useUpdates();
  const busy = ["checking", "downloading", "extracting"].includes(state.status);
  const action = async (fn) => {
    try {
      await fn();
    } catch (error) {
      notify(error.message);
    }
  };
  const labels = {
    idle: "Проверь, появилась ли новая версия.",
    checking: "Проверяем GitHub…",
    current: "У тебя актуальная версия.",
    available: `Доступна версия ${state.version}`,
    downloading: "Скачиваем обновление…",
    extracting: "Проверяем и распаковываем…",
    ready: `Версия ${state.version} готова к запуску.`,
    error: "Не удалось завершить обновление.",
  };
  return (
    <>
      <h3>Prestera {state.currentVersion || draft.version}</h3>
      <p className="notice" role="status">
        {labels[state.status]}
      </p>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.status === "downloading" && (
        <div>
          <progress
            aria-label="Загрузка обновления"
            max={state.total || 1}
            value={state.received || 0}
            style={{ width: "100%", accentColor: "var(--accent)" }}
          />
          <p className="muted small">
            {Math.round((state.received || 0) / 1048576)} /{" "}
            {Math.round((state.total || 0) / 1048576)} МБ
          </p>
          <button
            className="button secondary"
            onClick={() => action(() => bridge.cancelUpdate())}
          >
            Отменить загрузку
          </button>
        </div>
      )}
      <div className="two-fields">
        <button
          className="button secondary"
          disabled={busy || state.status === "ready"}
          onClick={() => action(() => bridge.checkUpdates())}
        >
          <RefreshCw size={16} /> Проверить обновления
        </button>
        {["available", "error"].includes(state.status) && state.version && (
          <button
            className="button primary"
            disabled={busy || !state.enabled}
            onClick={() => action(() => bridge.downloadUpdate())}
          >
            <Download size={16} /> Скачать обновление
          </button>
        )}
        {state.status === "ready" && (
          <button
            className="button primary"
            onClick={() => action(() => bridge.installUpdate())}
          >
            <RefreshCw size={16} /> Перезапустить и обновить
          </button>
        )}
      </div>
      <p className="muted small">
        Обновления скачиваются из sabatoshinka/prestera на GitHub и проверяются
        по SHA-256. Для перезапуска сначала выйди из комнаты. Текущая версия
        остаётся на диске.
      </p>
      {!state.enabled && (
        <p className="muted small">
          Установка доступна в готовой Windows-версии приложения.
        </p>
      )}
      <Toggle
        label="Проверять обновления при запуске"
        description="Сообщим о новой версии. Скачивание и перезапуск — по кнопке."
        checked={draft.checkUpdates ?? true}
        onChange={(value) => set("checkUpdates", value)}
      />
      <h3>Данные приложения</h3>
      <p className="muted small">
        Профиль, история, звуки и плейлисты хранятся отдельно от сборок. При
        обновлении они сохраняются автоматически. Музыка в плейлистах остаётся в
        исходных папках.
      </p>
      <p className="muted small" style={{ overflowWrap: "anywhere" }}>
        {draft.dataPath}
      </p>
      <button
        className="button secondary"
        onClick={() => action(() => bridge.openDataFolder())}
      >
        <FolderOpen size={16} /> Открыть папку данных
      </button>
    </>
  );
}
