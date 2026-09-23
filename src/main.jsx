import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Mic,
  MicOff,
  Headphones,
  HeadphoneOff,
  Video,
  VideoOff,
  MonitorUp,
  PhoneOff,
  Settings,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Copy,
  Check,
  X,
  Hash,
  AudioLines,
  Users,
  ShieldCheck,
  Radio,
  Volume2,
  VolumeX,
  Paperclip,
  Send,
  Smile,
  Play,
  Square,
  Trash2,
  Download,
  Maximize2,
  RefreshCw,
  Monitor,
  AppWindow,
  ChevronDown,
  Sparkles,
  Link,
  Cable,
  Info,
  MessageCircle,
  Loader2,
  Music2,
} from "lucide-react";
import { ClubEngine, QUALITY } from "./engine";
import { BitrateControl } from "./bitrate-control";
import { UpdatesPanel, useUpdates } from "./updates";
import { dbAll, dbPut, dbDelete, dbClear, recentMessages } from "./storage";
import { IconButton, Avatar, Modal, Field, Toggle } from "./ui";
import { ProfileDialog, ProfileSettings, PersonPopover } from "./profiles";
import { PRESENCES } from "./profile-data";
import {
  MediaViewer,
  SoundDock,
  SoundEditor,
  AppearanceSettings,
  MicrophoneSettings,
  MusicDock,
} from "./features";
import "./style.css";
import "./features.css";
import "./club.css";

const bridge = window.pibble;
const colors = [
  "#c3b3ea",
  "#e4b5bd",
  "#b4d1bc",
  "#e1c698",
  "#abc8df",
  "#c8bdd1",
];
const bytes = (n) =>
  n < 1024 * 1024
    ? `${Math.ceil(n / 1024)} КБ`
    : `${(n / 1024 / 1024).toFixed(1)} МБ`;
const friendlyError = (error) => {
  const text = error?.message || String(error);
  if (text.includes("Permission denied") || text.includes("NotAllowedError"))
    return "Доступ к устройству запрещён. Проверь разрешения камеры и микрофона в настройках Windows.";
  if (
    text.includes("Requested device not found") ||
    text.includes("NotFoundError")
  )
    return "Устройство не найдено. Подключи его и выбери в настройках.";
  if (text.includes("Could not start") || text.includes("NotReadableError"))
    return "Устройство занято или недоступно. Проверь, не использует ли его другое приложение.";
  return text.replace(/^Error invoking remote method '[^']+': Error: /, "");
};
function BrandMark({ size = 27 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8 26V6h10a7 7 0 0 1 0 14h-5"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="m21 24 3-3 3 3-3 3Z" fill="currentColor" />
    </svg>
  );
}
function RoomDialog({ mode, profile, initial, close, enter }) {
  const [connectionMode, setConnectionMode] = useState(
    profile.connectionMode || "direct",
  );
  const [serverUrl, setServerUrl] = useState(profile.serverUrl || "");
  const [serverKey, setServerKey] = useState(profile.serverKey || "");
  const [forceRelay, setForceRelay] = useState(profile.forceRelay || false);
  const [name, setName] = useState("Новая комната");
  const [nick, setNick] = useState(profile.name);
  const [port, setPort] = useState("45454");
  const [address, setAddress] = useState("");
  const [invite, setInvite] = useState(initial || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await enter(mode, {
        name,
        port,
        address,
        invite,
        connectionMode,
        serverUrl,
        serverKey,
        forceRelay,
        profile: { ...profile, name: nick.trim() || "Участник" },
      });
      close();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={mode === "host" ? "Создать комнату" : "Тебя уже ждут"}
      subtitle={
        mode === "host"
          ? "Выбери подключение через VPS или напрямую. Комната открыта, пока ты в ней."
          : "Вставь приглашение, которое отправил друг."
      }
      close={() => !busy && close()}
    >
      <form onSubmit={submit}>
        <Field label="Как тебя зовут">
          <input
            autoComplete="nickname"
            value={nick}
            onChange={(e) => setNick(e.target.value)}
            maxLength={32}
            required
          />
        </Field>
        {mode === "host" ? (
          <>
            <Field label="Название комнаты">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={48}
                required
              />
            </Field>
            <Field label="Подключение">
              <select
                value={connectionMode}
                onChange={(e) => setConnectionMode(e.target.value)}
              >
                <option value="direct">
                  Напрямую · локальная сеть / адрес
                </option>
                <option value="vps">Через VPS · без VPN</option>
              </select>
            </Field>
            {connectionMode === "vps" && (
              <>
                <Field label="Адрес VPS">
                  <input
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    type="url"
                    placeholder="https://prestera.example.org"
                    required
                  />
                </Field>
                <Field
                  label="Ключ создания комнат"
                  hint="Из конфигурации твоего VPS. Друзьям для входа достаточно приглашения."
                >
                  <input
                    type="password"
                    value={serverKey}
                    onChange={(e) => setServerKey(e.target.value)}
                    required
                  />
                </Field>
                <p className="notice">
                  Сначала пробуем прямую связь, при необходимости — TURN на этом
                  VPS. Сервер нужно предварительно настроить.
                </p>
              </>
            )}
            {connectionMode === "direct" && (
              <details className="advanced">
                <summary>
                  Подключение по интернету и порт <ChevronDown size={14} />
                </summary>
                <Field
                  label="Адрес для приглашения"
                  hint="Можно оставить пустым для одной сети. Для интернета укажи свой внешний IPv4 или домен."
                >
                  <input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Например, 192.168.1.10"
                  />
                </Field>
                <Field label="Порт комнаты">
                  <input
                    type="number"
                    min="1024"
                    max="65535"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    required
                  />
                </Field>
                <p className="notice">
                  Для интернета перенаправь этот порт TCP и UDP на свой ПК. При
                  сером IP удобнее общая VPN-сеть. Некоторые сети блокируют
                  прямую передачу — без ретранслятора она в них недоступна.
                </p>
              </details>
            )}
            <div className="inline-note">
              <ShieldCheck size={17} />
              <span>До 8 человек. Вход по приглашению с ключом.</span>
            </div>
          </>
        ) : (
          <>
            <Field label="Приглашение или адрес с ключом">
              <textarea
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                placeholder="prestera://join?host=… или адрес:порт#ключ"
                rows={4}
                required
                spellCheck={false}
              />
            </Field>
            <p className="notice">
              Создатель должен держать комнату открытой. В локальной или общей
              VPN-сети достаточно его адреса.
            </p>
          </>
        )}
        <Toggle
          label="Только через ретранслятор"
          description="Для VPS-комнат: весь голос и видео через TURN. Нужен работающий TURN на сервере."
          checked={forceRelay}
          onChange={setForceRelay}
        />
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <button type="submit" className="button primary full" disabled={busy}>
          {busy ? (
            <Loader2 className="spin" size={17} />
          ) : mode === "host" ? (
            <Plus size={18} />
          ) : (
            <ArrowRight size={18} />
          )}{" "}
          {busy
            ? "Подключаемся…"
            : mode === "host"
              ? "Создать комнату"
              : "Зайти к друзьям"}
        </button>
      </form>
    </Modal>
  );
}

function Home({ create, join }) {
  return (
    <div className="home">
      <div className="home-intro">
        <span className="eyebrow">
          <i /> МАЛЕНЬКИЙ КЛУБ. ТВОИ ЛЮДИ.
        </span>
        <h1>
          Будь на связи<span>.</span>
        </h1>
        <p>
          Разговаривай, делись экраном и слушай музыку вместе.
          <br />
          Всё рядом. Всё между вами.
        </p>
      </div>
      <div className="home-cards">
        <button className="home-card create" onClick={create}>
          <span className="card-icon">
            <Plus size={24} />
          </span>
          <h2>Своя комната</h2>
          <p>
            Создай место для друзей.
            <br />
            Ты здесь хозяин — буквально.
          </p>
          <span className="card-bottom">
            Создать комнату <ArrowUpRight size={20} />
          </span>
        </button>
        <button className="home-card" onClick={join}>
          <span className="card-icon">
            <Link size={23} />
          </span>
          <h2>К друзьям</h2>
          <p>
            Уже есть приглашение?
            <br />
            Залетай, тебя ждут.
          </p>
          <span className="card-bottom">
            Ввести приглашение <ArrowUpRight size={20} />
          </span>
        </button>
      </div>
      <div className="home-features">
        <span>
          <Mic size={16} /> Голос без шума
        </span>
        <span>
          <Monitor size={16} /> До 1080p · 60 FPS
        </span>
        <span>
          <Cable size={16} /> Прямое соединение
        </span>
      </div>
      <footer className="home-foot">
        <BrandMark size={18} />
        <span>разговор начинается здесь</span>
        <span className="foot-line" />
        <span>без аккаунтов и подписок</span>
      </footer>
    </div>
  );
}

function Media({
  stream,
  video = false,
  muted = false,
  volume = 1,
  sink = "",
  className = "",
}) {
  const ref = useRef();
  useEffect(() => {
    const el = ref.current;
    if (el.srcObject !== stream) el.srcObject = stream || null;
    el.play().catch(() => {});
    return () => {
      el.srcObject = null;
    };
  }, [stream]);
  useEffect(() => {
    const el = ref.current;
    el.muted = muted;
    el.volume = Math.max(0, Math.min(1, volume));
    el.setSinkId?.(sink || "").catch(() => {});
  }, [muted, volume, sink]);
  return video ? (
    <video ref={ref} autoPlay playsInline muted={muted} className={className} />
  ) : (
    <audio ref={ref} autoPlay muted={muted} />
  );
}
function CallStage({
  session,
  settings,
  volumes,
  setVolumes,
  openInvite,
  openMedia,
  openProfile,
}) {
  const { peers, state, room, localCamera, localScreen, micLevel } = session;
  const [watch, setWatch] = useState(null);
  const [volumePeer, setVolumePeer] = useState(null);
  const stage = useRef();
  const sharers = [
    ...(state.screen
      ? [
          {
            id: "self",
            name: "Твоя демонстрация",
            stream: localScreen,
            own: true,
          },
        ]
      : []),
    ...peers
      .filter((p) => p.state.screen)
      .map((p) => ({ ...p, stream: p.screenStream })),
  ];
  const active = sharers.find((s) => s.id === watch) || sharers[0];
  const persons = [
    {
      id: room.self,
      name: settings.name,
      color: settings.color,
      avatar: settings.avatar,
      frame: settings.frame,
      state,
      cameraStream: localCamera,
      own: true,
    },
    ...peers,
  ];
  return (
    <section className="call-stage" ref={stage}>
      <div className="stage-heading">
        <span>
          <Radio size={16} /> Голосовая комната <b>{persons.length}</b>
        </span>
        <button className="text-button" onClick={openInvite}>
          <Plus size={15} /> Пригласить
        </button>
      </div>
      {active && (
        <div className="screen-section">
          <div className="screen-top">
            <div className="share-tabs">
              {sharers.map((s) => (
                <button
                  key={s.id}
                  className={active.id === s.id ? "selected" : ""}
                  onClick={() => setWatch(s.id)}
                >
                  {s.own ? s.name : `${s.name} · экран`}
                </button>
              ))}
            </div>
            <IconButton
              icon={Maximize2}
              label="Развернуть демонстрацию в приложении"
              onClick={() =>
                openMedia({
                  kind: "screen",
                  id: active.own ? "self" : active.id,
                })
              }
            />
          </div>
          <div
            className="screen-player"
            onClick={() =>
              openMedia({ kind: "screen", id: active.own ? "self" : active.id })
            }
          >
            <Media
              video
              stream={active.stream}
              muted
              volume={
                (settings.outputGain / 100) *
                ((volumes[active.id]?.screen ?? 100) / 100)
              }
              sink={settings.output}
            />
          </div>
          <div className="screen-caption">
            <span className="live-dot" />{" "}
            {active.own
              ? session.screenInfo?.quality
              : active.stats?.height
                ? `${active.stats.width}×${active.stats.height} · ${Math.round(active.stats.fps || 0)} FPS`
                : "Ожидаем видео…"}
            <span>
              {active.own ? session.screenInfo?.name : "Поток участника"}
            </span>
          </div>
          <details className="stream-diagnostics">
            <summary>Качество и соединение</summary>
            {active.own && (
              <p>
                Захват: {session.screenInfo?.backend || "WebRTC"} ·{" "}
                {session.screenInfo?.width || "—"}×
                {session.screenInfo?.height || "—"} · цель{" "}
                {session.screenInfo?.quality}
              </p>
            )}
            {(active.own ? session.peers : [active]).map((p) => {
              const stats = active.own
                ? p.stats?.sendingScreen
                : p.stats?.screen;
              const reason = {
                cpu: "нагрузка на кодирование",
                bandwidth: "скорость соединения",
                other: "другое ограничение",
                none: "нет",
              }[stats?.limitation];
              return (
                <p key={p.id}>
                  <b>{p.name}</b>: {stats?.width || "—"}×{stats?.height || "—"}{" "}
                  · {stats?.fps ?? "—"} FPS · {stats?.kbps ?? "—"} кбит/с ·{" "}
                  {p.stats?.route === "relay"
                    ? "через TURN"
                    : p.stats?.route === "direct"
                      ? "напрямую"
                      : "соединяемся"}{" "}
                  · RTT {p.stats?.rtt ?? "—"} мс
                  {reason && ` · ограничение: ${reason}`}
                  {stats?.encodeMs !== undefined &&
                    ` · кодирование ${stats.encodeMs} мс/кадр`}
                  {stats?.bufferMs !== undefined &&
                    ` · буфер ${stats.bufferMs} мс`}
                  {stats?.dropped !== undefined &&
                    ` · пропущено ${stats.dropped} кадров`}
                  {stats?.lost !== undefined &&
                    ` · потеряно ${stats.lost} пакетов`}
                  {stats?.remoteLoss !== undefined &&
                    ` · потери у зрителя ${(stats.remoteLoss * 100).toFixed(1)}%`}
                  {stats?.recoveries > 0 &&
                    ` · попыток восстановления: ${stats.recoveries}`}
                </p>
              );
            })}
            {active.own && session.peers.length === 0 && (
              <p>Статистика отправки появится, когда подключится зритель.</p>
            )}
          </details>
        </div>
      )}
      <div
        className={`people-grid ${active ? "compact" : ""} count-${persons.length}`}
      >
        {persons.map((p) => (
          <div
            key={p.id}
            data-person={p.own ? "self" : p.id}
            className={`person-tile ${p.state.talking ? "speaking" : ""}`}
            onClick={(event) => {
              if (event.target.tagName === "VIDEO" && p.state.camera)
                openMedia({ kind: "camera", id: p.own ? "self" : p.id });
            }}
            onDoubleClick={() =>
              p.state.camera &&
              openMedia({ kind: "camera", id: p.own ? "self" : p.id })
            }
          >
            {p.state.camera ? (
              <Media
                video
                stream={p.cameraStream}
                muted
                className={p.own ? "mirror" : ""}
              />
            ) : (
              <Avatar
                name={p.name}
                color={p.color}
                avatar={p.avatar}
                frame={p.frame}
                onClick={() => openProfile(p.own ? "self" : p.id)}
                big
                talking={p.state.talking}
              />
            )}
            {p.own && !p.state.camera && <span className="tile-caption"></span>}
            {!p.own && p.connection !== "connected" && (
              <div className="connection-overlay">
                {p.connection === "failed"
                  ? "Нет прямого соединения"
                  : "Соединяемся…"}
              </div>
            )}
            <div className="person-label">
              <span
                className="profile-link"
                role="button"
                tabIndex={0}
                onClick={() => openProfile(p.own ? "self" : p.id)}
                onKeyDown={(e) =>
                  e.key === "Enter" && openProfile(p.own ? "self" : p.id)
                }
              >
                {p.name}
                {p.own && <small> ты</small>}
              </span>
              <span>
                {!p.own && p.stats.rtt !== undefined && (
                  <small>{p.stats.rtt} мс</small>
                )}
                {p.state.deafen ? (
                  <HeadphoneOff size={14} />
                ) : !p.state.mic ? (
                  <MicOff size={14} />
                ) : (
                  <Mic size={14} />
                )}
              </span>
            </div>
            {!p.own && (
              <button
                className="tile-volume"
                aria-label={`Громкость ${p.name}`}
                onClick={() => setVolumePeer(volumePeer === p.id ? null : p.id)}
              >
                <Volume2 size={15} />
              </button>
            )}
            {p.state.camera && (
              <button
                className="tile-expand"
                aria-label={`Развернуть камеру ${p.name}`}
                title="Развернуть камеру в приложении"
                onClick={() =>
                  openMedia({ kind: "camera", id: p.own ? "self" : p.id })
                }
              >
                <Maximize2 size={16} />
              </button>
            )}
            {volumePeer === p.id && (
              <div className="volume-popover">
                <span>Громкость · {volumes[p.id]?.voice ?? 100}%</span>
                <input
                  aria-label={`Уровень ${p.name}`}
                  type="range"
                  min="0"
                  max="100"
                  value={volumes[p.id]?.voice ?? 100}
                  onChange={(e) =>
                    setVolumes((v) => ({
                      ...v,
                      [p.id]: { ...v[p.id], voice: +e.target.value },
                    }))
                  }
                />
              </div>
            )}
          </div>
        ))}
        {persons.length === 1 && !active && (
          <button className="invite-tile" onClick={openInvite}>
            <span>
              <Plus size={24} />
            </span>
            <b>Место для твоих людей</b>
            <small>Отправь приглашение другу</small>
          </button>
        )}
      </div>
      {!active && (
        <div className="stage-note">
          <ShieldCheck size={15} />
          <span>Голос и видео защищены шифрованием.</span>
        </div>
      )}
    </section>
  );
}

function FileContent({ file, save, open }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file?.blob) return;
    const next = URL.createObjectURL(file.blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file?.blob]);
  const image =
    /^image\/(png|jpeg|gif|webp|avif|bmp)$/i.test(
      file.mime || file.blob?.type || "",
    ) || /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(file.name);
  return (
    <div className={`attachment ${image ? "image-attachment" : ""}`}>
      {image && url && (
        <button
          className="image-preview"
          aria-label={`Открыть изображение ${file.name}`}
          onClick={() => open({ file, title: file.name, save })}
        >
          <img src={url} alt={file.name} loading="lazy" />
        </button>
      )}
      <button
        onClick={image ? () => open({ file, title: file.name, save }) : save}
      >
        <span>
          <b>{file.name}</b>
          <small>
            {bytes(file.size)}
            {file.mime === "image/gif" ? " · GIF" : ""}
          </small>
        </span>
        {image ? <Maximize2 size={16} /> : <Download size={16} />}
      </button>
      {image && (
        <button
          className="attachment-download"
          onClick={save}
          aria-label={`Скачать ${file.name}`}
        >
          <Download size={14} /> Скачать
        </button>
      )}
    </div>
  );
}
function Chat({
  openProfile,
  openMedia,
  messages,
  room,
  sendText,
  sendFiles,
  progress,
  notify,
  full = false,
}) {
  const [text, setText] = useState("");
  const [emoji, setEmoji] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef();
  const end = useRef();
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, progress]);
  const submit = (e) => {
    e.preventDefault();
    if (!room) return;
    sendText(text);
    setText("");
    setEmoji(false);
  };
  const attach = (files) => {
    if (files?.length) sendFiles([...files]);
  };
  return (
    <section
      className={`chat ${full ? "full-chat" : ""} ${drag ? "dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDrag(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        attach(e.dataTransfer.files);
      }}
    >
      <header>
        <div>
          <Hash size={18} />
          <b>уютный-чат</b>
        </div>
        <span>для своих</span>
      </header>
      <div className="messages">
        {!messages.length ? (
          <div className="chat-empty">
            <MessageCircle size={29} strokeWidth={1.4} />
            <h3>Здесь начинается разговор</h3>
            <p>
              Поздоровайся.
              <br />
              Или отправь картинку.
            </p>
            <small>Картинки и GIF можно перетащить сюда</small>
          </div>
        ) : (
          messages.map((msg) => (
            <article
              key={msg.id}
              className="message"
              data-person={msg.own ? "self" : msg.from}
            >
              <Avatar
                name={msg.name}
                color={msg.color}
                avatar={msg.avatar}
                onClick={
                  openProfile
                    ? () => openProfile(msg.own ? "self" : msg.from)
                    : undefined
                }
              />
              <div className="message-body">
                <div className="message-meta">
                  <b style={{ color: colors[(msg.color || 0) % 6] }}>
                    {msg.name}
                  </b>
                  <time>
                    {new Date(msg.time).toLocaleTimeString("ru", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
                {msg.text && <p>{msg.text}</p>}
                {msg.file && (
                  <FileContent
                    open={openMedia}
                    file={msg.file}
                    save={async () => {
                      try {
                        await bridge.saveFile({
                          name: msg.file.name,
                          data: new Uint8Array(
                            await msg.file.blob.arrayBuffer(),
                          ),
                        });
                      } catch (err) {
                        notify(friendlyError(err));
                      }
                    }}
                  />
                )}
              </div>
            </article>
          ))
        )}
        <div ref={end} />
      </div>
      {progress !== null && (
        <div className="transfer-progress">
          <span>Передаём файл… {progress}%</span>
          <progress value={progress} max="100" />
        </div>
      )}
      <form className="composer" onSubmit={submit}>
        <textarea
          aria-label="Сообщение"
          placeholder={room ? "Написать сообщение…" : "Сначала войди в комнату"}
          value={text}
          disabled={!room}
          maxLength={8000}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) submit(e);
          }}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault();
              attach(e.clipboardData.files);
            }
          }}
        />
        <div className="composer-tools">
          <div>
            <IconButton
              icon={Paperclip}
              label="Прикрепить картинку, GIF или файл"
              disabled={!room || progress !== null}
              onClick={() => input.current.click()}
              type="button"
            />
            <IconButton
              icon={Smile}
              label="Эмодзи"
              disabled={!room}
              onClick={() => setEmoji(!emoji)}
              type="button"
            />
            <button
              type="button"
              className="gif-button"
              disabled={!room}
              onClick={() => {
                input.current.accept = "image/gif";
                input.current.click();
              }}
            >
              GIF
            </button>
          </div>
          <button
            className="send-button"
            type="submit"
            disabled={!room || !text.trim()}
            aria-label="Отправить"
          >
            <ArrowRight size={19} />
          </button>
        </div>
        {emoji && (
          <div className="emoji-picker">
            {[
              "🐶",
              "🐾",
              "🤍",
              "😭",
              "🫧",
              "🦴",
              "😂",
              "✨",
              "👀",
              "💜",
              "👍",
              "🫶",
            ].map((e) => (
              <button
                type="button"
                key={e}
                onClick={() => {
                  setText((t) => t + e);
                  setEmoji(false);
                }}
              >
                {e}
              </button>
            ))}
          </div>
        )}
        <input
          type="file"
          ref={input}
          hidden
          multiple
          onChange={(e) => {
            attach(e.target.files);
            e.target.value = "";
            e.target.accept = "";
          }}
        />
      </form>
      <div className="chat-foot">
        Enter — отправить · Shift + Enter — новая строка
      </div>
    </section>
  );
}

function synthTone(kind) {
  const rate = 48000,
    duration = kind === 0 ? 0.24 : kind === 1 ? 0.58 : 0.38,
    length = Math.floor(rate * duration),
    buffer = new ArrayBuffer(44 + length * 2),
    view = new DataView(buffer);
  const write = (offset, text) =>
    [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, length * 2, true);
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const t = i / rate,
      local = kind === 1 ? t % 0.19 : t,
      frequency =
        kind === 0 ? 640 - t * 1700 : kind === 1 ? 430 + local * 4000 : 880;
    phase += (2 * Math.PI * frequency) / rate;
    const envelope =
      Math.min(1, local / 0.008) * Math.exp(-local * (kind === 1 ? 26 : 15));
    view.setInt16(44 + i * 2, Math.sin(phase) * envelope * 10000, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
function ShareDialog({
  close,
  start,
  devices,
  quality: initialQuality,
  streamMbps: initialMbps,
  viewers,
  captureMode,
  notify,
}) {
  const [sources, setSources] = useState([]),
    [selected, setSelected] = useState(null),
    [tab, setTab] = useState("window"),
    [audio, setAudio] = useState("app"),
    [quality, setQuality] = useState(initialQuality || "1080p60"),
    [streamMbps, setStreamMbps] = useState(initialMbps || 0),
    [mode, setMode] = useState(captureMode || "borderless"),
    [device, setDevice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const refresh = async () => {
    setLoading(true);
    try {
      setSources(await bridge.sources());
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    refresh();
  }, []);
  const chooseTab = (next) => {
    setTab(next);
    setSelected(null);
    setAudio(next === "window" ? "app" : "none");
  };
  return (
    <Modal
      title="Покажи, что у тебя"
      subtitle="Выбери окно или экран. Ты управляешь тем, что слышат друзья."
      close={() => !busy && close()}
      wide
    >
      <div className="picker-toolbar">
        <div className="segmented">
          <button
            className={tab === "window" ? "selected" : ""}
            onClick={() => chooseTab("window")}
          >
            <AppWindow size={16} /> Приложение
          </button>
          <button
            className={tab === "screen" ? "selected" : ""}
            onClick={() => chooseTab("screen")}
          >
            <Monitor size={16} /> Экран
          </button>
        </div>
        <IconButton
          icon={RefreshCw}
          label="Обновить список окон"
          onClick={refresh}
        />
      </div>
      <div className="source-grid">
        {loading ? (
          <div className="picker-empty">
            <Loader2 className="spin" /> Ищем окна…
          </div>
        ) : (
          sources
            .filter((s) => s.id.startsWith(tab + ":"))
            .map((source) => (
              <button
                className={`source ${selected?.id === source.id ? "selected" : ""}`}
                key={source.id}
                onClick={() => setSelected(source)}
              >
                <img src={source.thumbnail} alt="" />
                <span>{source.name}</span>
                {selected?.id === source.id && (
                  <i>
                    <Check size={14} />
                  </i>
                )}
              </button>
            ))
        )}
        {!loading && !sources.some((s) => s.id.startsWith(tab + ":")) && (
          <p className="picker-empty">
            Открытых окон не найдено. Открой приложение и обнови список.
          </p>
        )}
      </div>
      <div className="share-settings">
        <Field label="Качество">
          <select value={quality} onChange={(e) => setQuality(e.target.value)}>
            {Object.entries(QUALITY).map(([id, q]) => (
              <option key={id} value={id}>
                {q.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Что слышат друзья">
          <select value={audio} onChange={(e) => setAudio(e.target.value)}>
            {tab === "window" && (
              <option value="app">Только выбранное приложение</option>
            )}
            <option value="none">Без звука</option>
            {(tab === "screen" || mode === "compatible") && (
              <option value="system">Все звуки компьютера</option>
            )}
            <option value="device">Выбранное аудиоустройство</option>
          </select>
        </Field>
      </div>
      <BitrateControl
        value={streamMbps}
        onChange={setStreamMbps}
        viewers={viewers}
        defaultMbps={(QUALITY[quality]?.bitrate || 10000000) / 1000000}
      />
      {tab === "window" && (
        <Field label="Способ захвата окна">
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              if (audio === "system") setAudio("app");
            }}
          >
            <option value="borderless">Без рамки</option>
            <option value="compatible">
              Совместимый · рамка Windows возможна
            </option>
          </select>
          <p className="muted small">
            Режим без рамки подбирает способ захвата окна. Запасной способ
            сильнее нагружает процессор. Не сворачивай окно во время показа.
            Если захват недоступен, можно выбрать совместимый режим.
          </p>
        </Field>
      )}
      {audio === "device" && (
        <Field label="Аудиоустройство">
          <select value={device} onChange={(e) => setDevice(e.target.value)}>
            <option value="">Выбери устройство</option>
            {devices
              .filter((d) => d.kind === "audioinput")
              .map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || "Аудиовход"}
                </option>
              ))}
          </select>
        </Field>
      )}
      {audio === "system" && (
        <p className="notice">
          Будут слышны уведомления, другие приложения и разговор в комнате. Для
          изоляции звука выбери приложение.
        </p>
      )}
      <p className="muted small">
        60 FPS — целевой режим. Частота кадров зависит от нагрузки, движения в
        кадре и скорости сети.
      </p>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <button
        className="button primary full"
        disabled={!selected || busy || (audio === "device" && !device)}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await start({
              ...selected,
              audio,
              quality,
              device,
              mode,
              streamMbps,
            });
            close();
          } catch (err) {
            setError(friendlyError(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? (
          <Loader2 className="spin" size={18} />
        ) : (
          <MonitorUp size={18} />
        )}{" "}
        {busy ? "Запускаем демонстрацию…" : "Начать демонстрацию"}
      </button>
    </Modal>
  );
}

function SettingsDialog({
  initialTab = "audio",
  settings,
  save,
  close,
  devices,
  refreshDevices,
  notify,
}) {
  const [draft, setDraft] = useState(settings),
    [tab, setTab] = useState(initialTab),
    [busy, setBusy] = useState(false);
  const set = (key, value) => setDraft((s) => ({ ...s, [key]: value }));
  const selectDevice = (label, key, kind) => (
    <Field label={label}>
      <select value={draft[key]} onChange={(e) => set(key, e.target.value)}>
        <option value="">По умолчанию в Windows</option>
        {devices
          .filter(
            (d) =>
              d.kind === kind &&
              d.deviceId !== "default" &&
              d.deviceId !== "communications",
          )
          .map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `${label} ${i + 1}`}
            </option>
          ))}
      </select>
    </Field>
  );
  return (
    <Modal
      title="По-твоему"
      subtitle="Устройства, профиль и быстрые действия."
      close={() => !busy && close()}
      wide
    >
      <div className="settings-tabs">
        {[
          ["audio", "Голос и видео"],
          ["keys", "Горячие клавиши"],
          ["profile", "Профиль и данные"],
          ["updates", "Обновления"],
        ].map(([id, name]) => (
          <button
            key={id}
            className={tab === id ? "selected" : ""}
            onClick={() => setTab(id)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="settings-content">
        {tab === "audio" ? (
          <>
            <div className="two-fields">
              {selectDevice("Микрофон", "mic", "audioinput")}
              {selectDevice("Наушники / динамики", "output", "audiooutput")}
            </div>
            {selectDevice("Камера", "camera", "videoinput")}
            <button className="text-button" onClick={refreshDevices}>
              <RefreshCw size={14} /> Обновить устройства
            </button>
            <div className="sliders">
              {[
                ["micGain", "Усиление микрофона", 200],
                ["outputGain", "Громкость участников", 100],
                ["soundGain", "Громкость звуковой панели", 100],
              ].map(([key, label, max]) => (
                <label className="slider" key={key}>
                  <span>
                    {label}
                    <b>{draft[key]}%</b>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max={max}
                    value={draft[key]}
                    onChange={(e) => set(key, +e.target.value)}
                  />
                </label>
              ))}
            </div>
            <MicrophoneSettings draft={draft} set={set} notify={notify} />
            <BitrateControl
              value={draft.streamMbps}
              onChange={(value) => set("streamMbps", value)}
              defaultMbps={
                (QUALITY[draft.quality]?.bitrate || 10000000) / 1000000
              }
            />
            <p className="muted small">
              Новый лимит применяется после сохранения, в том числе к текущему
              стриму.
            </p>
            <Toggle
              label="Звуки событий"
              description="Вход и выход, микрофон, наушники, камера и демонстрация. Слышны только тебе."
              checked={draft.eventSounds ?? true}
              onChange={(v) => set("eventSounds", v)}
            />
            <Toggle
              label="Звук входящих сообщений"
              description="Тихий сигнал для текста, картинок и файлов. Использует громкость уведомлений."
              checked={draft.messageSounds ?? true}
              onChange={(v) => set("messageSounds", v)}
            />
            <label className="slider">
              <span>
                Громкость уведомлений<b>{draft.eventGain ?? 25}%</b>
              </span>
              <input
                aria-label="Громкость уведомлений"
                type="range"
                min="0"
                max="100"
                value={draft.eventGain ?? 25}
                onChange={(e) => set("eventGain", +e.target.value)}
              />
            </label>
            <Field label="Захват окон по умолчанию">
              <select
                value={draft.captureMode || "borderless"}
                onChange={(e) => set("captureMode", e.target.value)}
              >
                <option value="borderless">Без рамки</option>
                <option value="compatible">
                  Совместимый · рамка Windows возможна
                </option>
              </select>
            </Field>
            <Toggle
              label="Эхоподавление"
              description="Помогает, если ты слушаешь через динамики."
              checked={draft.echo}
              onChange={(v) => set("echo", v)}
            />
          </>
        ) : tab === "updates" ? (
          <UpdatesPanel draft={draft} set={set} notify={notify} />
        ) : tab === "keys" ? (
          <>
            <p className="notice">
              Работают, даже когда приложение свёрнуто. Формат: Control+Shift+M,
              Alt+F9. Очисти поле, чтобы отключить сочетание.
            </p>
            {Object.entries({
              mic: "Микрофон",
              deafen: "Весь звук",
              camera: "Камера",
              screen: "Демонстрация",
              sound0: "Первый звук",
              sound1: "Второй звук",
              sound2: "Третий звук",
            }).map(([key, label]) => (
              <div className="key-row" key={key}>
                <label htmlFor={"key-" + key}>{label}</label>
                <input
                  id={"key-" + key}
                  value={draft.hotkeys[key]}
                  onChange={(e) =>
                    set("hotkeys", { ...draft.hotkeys, [key]: e.target.value })
                  }
                  placeholder="Отключено"
                  maxLength={60}
                  spellCheck={false}
                />
              </div>
            ))}
          </>
        ) : (
          <>
            <Field label="Имя">
              <input
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                maxLength={32}
              />
            </Field>
            <Field label="Твой цвет">
              <div className="color-picker">
                {colors.map((c, i) => (
                  <button
                    key={c}
                    style={{ background: c }}
                    aria-label={`Цвет ${i + 1}`}
                    onClick={() => set("color", i)}
                  >
                    {draft.color === i && <Check size={18} />}
                  </button>
                ))}
              </div>
            </Field>
            <AppearanceSettings draft={draft} set={set} notify={notify} />
            <ProfileSettings draft={draft} set={set} notify={notify} />
            <p className="notice">
              Профиль обновляется сразу. История и добавленные звуки хранятся на
              этом компьютере.
            </p>
            <button
              className="button secondary"
              onClick={async () => {
                try {
                  const ok = await bridge.registerLinks();
                  notify(
                    ok
                      ? "Приглашения prestera:// теперь открываются в Prestera."
                      : "Windows не разрешила связать ссылки с приложением. Можно вставлять приглашение вручную.",
                  );
                } catch (error) {
                  notify(friendlyError(error));
                }
              }}
            >
              <Link size={16} /> Открывать приглашения этим приложением
            </button>
            <div className="data-row">
              <div>
                <b>Локальная история</b>
                <small>Удаление очистит только твою копию сообщений.</small>
              </div>
              <button
                className="button secondary"
                onClick={async () => {
                  await dbClear("messages");
                  await dbClear("attachments");
                  notify(
                    "Сохранённая история очищена. Сообщения текущей комнаты останутся до выхода.",
                  );
                }}
              >
                Очистить
              </button>
            </div>
          </>
        )}
      </div>
      <button
        className="button primary full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await save(draft);
            close();
          } catch (err) {
            notify(friendlyError(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Сохраняем…" : "Сохранить настройки"}
      </button>
    </Modal>
  );
}

function App() {
  const update = useUpdates();
  const [settings, setSettings] = useState(null),
    [session, setSession] = useState({ room: null, peers: [], state: {} }),
    [view, setView] = useState("room"),
    [modal, setModal] = useState(null),
    [dock, setDock] = useState(null),
    [editingSound, setEditingSound] = useState(null),
    [viewer, setViewer] = useState(null),
    [profileId, setProfileId] = useState(null),
    [personPopup, setPersonPopup] = useState(null),
    [settingsTab, setSettingsTab] = useState("audio"),
    [initialInvite, setInitialInvite] = useState(""),
    [messages, setMessages] = useState([]),
    [sounds, setSounds] = useState([]),
    [devices, setDevices] = useState([]),
    [toasts, setToasts] = useState([]),
    [copied, setCopied] = useState(false),
    [progress, setProgress] = useState(null),
    [volumes, setVolumes] = useState({});
  const profileAnchor = useRef({ x: 280, y: 140 });
  const showProfile = (id) =>
    setPersonPopup({ id, position: profileAnchor.current, context: false });
  const updatePersonVolume = (id, key, value) =>
    setVolumes((v) => ({
      ...v,
      [id]: {
        ...(typeof v[id] === "object" ? v[id] : { voice: v[id] ?? 100 }),
        [key]: value,
      },
    }));
  const engine = useRef(),
    current = useRef(),
    fileBusy = useRef(false);
  current.current = {
    settings,
    session,
    sounds,
    modal:
      modal ||
      (editingSound ? "sound-editor" : null) ||
      (profileId ? "profile" : null),
  };
  useEffect(() => {
    if (!viewer?.kind) return;
    const person =
      viewer.id === "self"
        ? session
        : session.peers.find((p) => p.id === viewer.id);
    if (!person?.state?.[viewer.kind === "camera" ? "camera" : "screen"])
      setViewer(null);
  }, [viewer, session]);
  const notify = (text) => {
    const id = crypto.randomUUID();
    setToasts((t) => [...t.slice(-2), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6500);
  };
  const guarded =
    (fn) =>
    async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        notify(friendlyError(error));
      }
    };
  const refreshDevices = async () => {
    try {
      setDevices(await navigator.mediaDevices.enumerateDevices());
    } catch {}
  };
  const acceptMessage = (msg) => {
    setMessages((previous) =>
      previous.some((m) => m.id === msg.id) ? previous : [...previous, msg],
    );
    dbPut("messages", msg).catch(() =>
      notify(
        "Не удалось сохранить историю: возможно, на диске закончилось место.",
      ),
    );
  };
  useEffect(() => {
    engine.current = new ClubEngine(setSession, acceptMessage, notify);
    bridge.getSettings().then((s) => {
      setSettings(s);
      engine.current.settings = s;
      if (s.hotkeyFailures?.length)
        notify(
          "Некоторые горячие клавиши заняты другим приложением. Их можно изменить в настройках.",
        );
      if (s.pendingInvite) {
        setInitialInvite(s.pendingInvite);
        setModal("join");
      }
    });
    dbAll("sounds")
      .then(async (list) => {
        if (!list.length && !localStorage.getItem("sounds-seeded")) {
          const built = ["Буп", "Пузырьки", "Сигнал"].map((name, i) => ({
            id: "builtin-" + i,
            name,
            blob: synthTone(i),
            created: i,
          }));
          for (const s of built) await dbPut("sounds", s);
          localStorage.setItem("sounds-seeded", "yes");
          list = built;
        }
        setSounds(list.sort((a, b) => a.created - b.created));
      })
      .catch(() => notify("Не удалось открыть звуковую панель."));
    refreshDevices();
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    const hotkey = bridge.onHotkey((action) => {
      if (current.current.modal) return;
      const engineNow = engine.current;
      if (action === "mic") guarded(() => engineNow.toggleMic())();
      if (action === "deafen") engineNow.toggleDeafen();
      if (action === "camera") guarded(() => engineNow.toggleCamera())();
      if (action === "screen" && engineNow.room) {
        if (engineNow.state.screen) guarded(() => engineNow.stopShare())();
        else {
          refreshDevices();
          setModal("share");
        }
      }
      if (/^sound\d$/.test(action)) {
        const sound = current.current.sounds[+action.slice(-1)];
        if (sound && engineNow.room)
          guarded(() => engineNow.playSound(sound))();
      }
    });
    const inviteEvent = bridge.onInvite((text) => {
      setInitialInvite(text);
      setModal("join");
    });
    return () => {
      hotkey();
      inviteEvent();
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        refreshDevices,
      );
      engine.current.dispose();
    };
  }, []);
  const enter = async (mode, value) => {
    if (engine.current.room) await engine.current.leave();
    const profile = {
      ...settings,
      name: value.profile.name,
      forceRelay: value.forceRelay,
      ...(mode === "host"
        ? {
            connectionMode: value.connectionMode,
            serverUrl:
              value.connectionMode === "vps"
                ? value.serverUrl
                : settings.serverUrl,
            serverKey: value.serverKey,
          }
        : {}),
    };
    await bridge.saveSettings(profile);
    setSettings(profile);
    const result =
      mode === "host" ? await bridge.host(value) : await bridge.join(value);
    setMessages(await recentMessages(result.roomId));
    try {
      await engine.current.enter(result, profile);
    } catch (error) {
      await engine.current.leave();
      throw error;
    }
    setView("room");
    refreshDevices();
  };
  const saveSettings = async (value) => {
    const result = await bridge.saveSettings(value);
    setSettings(value);
    await engine.current.applySettings(value);
    if (result.failures.length)
      notify(
        "Эти сочетания заняты или некорректны: " + result.failures.join(", "),
      );
    else notify("Настройки сохранены");
  };
  useEffect(() => {
    let cancelled = false;
    if (!session.room)
      recentMessages()
        .then((list) => {
          if (!cancelled) setMessages(list);
        })
        .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session.room?.roomId]);
  const copyInvite = guarded(async () => {
    await bridge.copy(session.room.invite);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  });
  const sendFiles = guarded(async (files) => {
    if (fileBusy.current) return notify("Дождись завершения текущей передачи");
    if (!engine.current.room) return notify("Сначала войди в комнату");
    fileBusy.current = true;
    try {
      for (const file of files) {
        setProgress(0);
        await engine.current.sendFile(file, setProgress);
      }
    } finally {
      fileBusy.current = false;
      setProgress(null);
    }
  });
  const saveSound = async (sound) => {
    await dbPut("sounds", sound);
    setSounds((list) =>
      list.some((s) => s.id === sound.id)
        ? list.map((s) => (s.id === sound.id ? sound : s))
        : [...list, sound],
    );
  };
  const quickSetting = guarded(async (key, value) => {
    const next = { ...current.current.settings, [key]: value };
    setSettings(next);
    await engine.current.applySettings(next);
    await bridge.saveSettings(next);
  });
  const removeSound = guarded(async (id) => {
    await dbDelete("sounds", id);
    setSounds((s) => s.filter((x) => x.id !== id));
  });
  if (!settings)
    return (
      <div className="loading">
        <BrandMark size={36} />
        <span>Prestera</span>
        <Loader2 className="spin" size={20} />
      </div>
    );
  const room = session.room,
    state = session.state,
    connected = session.peers.filter(
      (p) => p.connection === "connected",
    ).length;
  const chat = (
    <Chat
      openProfile={(id) => {
        if (id === "self" || session.peers.some((p) => p.id === id))
          showProfile(id);
        else notify("Этот участник уже вышел из комнаты");
      }}
      openMedia={setViewer}
      messages={messages}
      room={room}
      sendText={(text) => engine.current.sendText(text)}
      sendFiles={sendFiles}
      progress={progress}
      notify={notify}
      full={view === "chat"}
    />
  );
  return (
    <div
      className={`app-shell ${settings.background ? "has-background" : ""}`}
      onClickCapture={(e) => {
        const r = (
          e.target.closest("button, .avatar, [data-person]") || e.target
        ).getBoundingClientRect();
        profileAnchor.current = { x: r.right + 8, y: r.top };
      }}
      onContextMenu={(e) => {
        const target = e.target.closest("[data-person]");
        if (target) {
          e.preventDefault();
          setPersonPopup({
            id: target.dataset.person,
            position: { x: e.clientX, y: e.clientY },
            context: true,
          });
        }
      }}
      style={{
        "--lavender": settings.accent || "#c5b5e8",
        "--club-background": settings.background
          ? `url("${settings.background}")`
          : "none",
        "--background-dim": (settings.backgroundDim ?? 75) / 100,
      }}
    >
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("room");
          }}
        >
          <span className="brand-mark">
            <BrandMark />
          </span>
          <span>prestera</span>
          <small>β</small>
        </a>
        <div className="sidebar-group">
          <span className="sidebar-caption">ТВОЁ МЕСТО</span>
          <nav>
            {[
              ["room", Radio, "Комната"],
              ["chat", Hash, "Чат"],
            ].map(([id, Icon, label]) => (
              <button
                key={id}
                className={view === id ? "selected" : ""}
                onClick={() => setView(id)}
              >
                <Icon size={18} />
                {label}
                {id === "room" && room && <i />}
              </button>
            ))}
          </nav>
        </div>
        {room && (
          <div className="sidebar-room">
            <div className="sidebar-caption">
              В КОМНАТЕ <span>{session.peers.length + 1} / 8</span>
            </div>
            <div
              className="sidebar-person profile-link"
              role="button"
              tabIndex={0}
              aria-label={`Профиль ${settings.name}`}
              data-person="self"
              onClick={() => showProfile("self")}
              onKeyDown={(e) => e.key === "Enter" && showProfile("self")}
            >
              <Avatar
                name={settings.name}
                color={settings.color}
                avatar={settings.avatar}
                frame={settings.frame}
                talking={state.talking}
              />
              <span>
                {settings.name}
                <small className={`presence-label ${settings.presence}`}>
                  {PRESENCES[settings.presence] || "В сети"}
                </small>
              </span>
              {state.mic ? <Mic size={13} /> : <MicOff size={13} />}
            </div>
            {session.peers.map((p) => (
              <div
                className="sidebar-person profile-link"
                key={p.id}
                role="button"
                tabIndex={0}
                aria-label={`Профиль ${p.name}`}
                data-person={p.id}
                onClick={() => showProfile(p.id)}
                onKeyDown={(e) => e.key === "Enter" && showProfile(p.id)}
              >
                <Avatar
                  name={p.name}
                  color={p.color}
                  avatar={p.avatar}
                  frame={p.frame}
                  talking={p.state.talking}
                />
                <span>
                  {p.name}
                  <small>
                    {p.connection === "connected"
                      ? PRESENCES[p.presence] || "В сети"
                      : "подключается"}
                  </small>
                </span>
                {p.state.mic ? <Mic size={13} /> : <MicOff size={13} />}
              </div>
            ))}
          </div>
        )}
        <div className="sidebar-spacer" />
        {["available", "downloading", "extracting", "ready"].includes(
          update.status,
        ) && (
          <button
            className="settings-button"
            onClick={() => {
              setSettingsTab("updates");
              setModal("settings");
            }}
          >
            <Download size={17} />{" "}
            {update.status === "ready"
              ? "Обновление готово"
              : update.status === "available"
                ? `Доступна ${update.version}`
                : "Загрузка обновления…"}
          </button>
        )}
        <div className="sidebar-aside">
          <Sparkles size={16} />
          <p>
            Хорошо, когда
            <br />
            все свои.
          </p>
        </div>
        <button
          className="settings-button"
          onClick={() => {
            refreshDevices();
            setSettingsTab("audio");
            setModal("settings");
          }}
        >
          <Settings size={17} /> Настройки
        </button>
        <div
          className="profile profile-link"
          role="button"
          tabIndex={0}
          aria-label="Мой профиль"
          data-person="self"
          onClick={() => showProfile("self")}
          onKeyDown={(e) => e.key === "Enter" && showProfile("self")}
        >
          <Avatar
            name={settings.name}
            color={settings.color}
            avatar={settings.avatar}
            frame={settings.frame}
          />
          <div>
            <b>{settings.name}</b>
            <small>
              <i className={`presence-${settings.presence || "online"}`} />
              {PRESENCES[settings.presence] || "В сети"}
            </small>
          </div>
          <span className="version">{settings.version}</span>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Prestera</span>
            <i>/</i>
            <b>{view === "chat" ? "Чат" : room ? room.roomName : "Главная"}</b>
          </div>
          <div className={`connection-pill ${room ? "online" : ""}`}>
            <i />
            {room
              ? connected
                ? `P2P · ${connected} на связи`
                : "Комната открыта"
              : "Сейчас тихо"}
          </div>
        </header>
        <div className="main-body">
          {view === "chat" ? (
            <div className="chat-view">
              <div className="section-title">
                <div>
                  <span className="eyebrow">ДЛЯ ВАЖНОГО И СМЕШНОГО</span>
                  <h1>
                    Разговор остаётся<span>.</span>
                  </h1>
                  <p>
                    {room
                      ? room.roomName
                      : "Войди в комнату, чтобы начать общение."}
                  </p>
                </div>
                {!room && (
                  <button
                    className="button primary"
                    onClick={() => setModal("join")}
                  >
                    К друзьям <ArrowRight size={17} />
                  </button>
                )}
              </div>
              {chat}
            </div>
          ) : room ? (
            <div className="room-view">
              <div className="room-title">
                <div>
                  <span className="eyebrow">ВАША КОМНАТА</span>
                  <h1>{room.roomName}</h1>
                </div>
                <button
                  className="button secondary"
                  onClick={copyInvite}
                  title="Приглашение даёт доступ к комнате. Отправляй его только своим."
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
                  {copied ? "Скопировано" : "Приглашение"}
                </button>
              </div>
              <div className="room-content">
                <CallStage
                  session={session}
                  settings={settings}
                  volumes={volumes}
                  setVolumes={setVolumes}
                  openInvite={() => setModal("invite")}
                  openMedia={setViewer}
                  openProfile={showProfile}
                />
                {chat}
              </div>
            </div>
          ) : (
            <Home
              create={() => setModal("host")}
              join={() => setModal("join")}
            />
          )}
        </div>
        <footer className="callbar">
          {dock === "sounds" && (
            <SoundDock
              sounds={sounds}
              add={setEditingSound}
              edit={setEditingSound}
              remove={removeSound}
              play={guarded((sound, preview) =>
                engine.current.playSound(sound, preview),
              )}
              stop={() => engine.current.stopSounds()}
              room={room}
              volume={settings.soundGain}
              setVolume={(v) => quickSetting("soundGain", v)}
              close={() => setDock(null)}
            />
          )}
          <div hidden={dock !== "music"}>
            <MusicDock
              engine={engine.current}
              music={session.music}
              room={room}
              peers={session.peers}
              settings={settings}
              setVolume={(v) => quickSetting("musicGain", v)}
              close={() => setDock(null)}
              notify={notify}
            />
          </div>
          <div className="callbar-status">
            <span className={`call-status-icon ${room ? "online" : ""}`}>
              <Radio size={20} />
            </span>
            <div>
              <b>{room ? room.roomName : "Разговор в одном клике"}</b>
              <small>
                {room ? (
                  <>
                    <span className="live-dot" />{" "}
                    {connected
                      ? room.connectionMode === "vps"
                        ? "Связь через интернет"
                        : "Прямое соединение"
                      : "Ждём друзей"}
                  </>
                ) : (
                  "Создай комнату или зайди к друзьям"
                )}
              </small>
            </div>
          </div>
          <div className="call-controls">
            <IconButton
              icon={state.mic ? Mic : MicOff}
              label={`Микрофон · ${settings.hotkeys.mic}`}
              active={state.mic}
              disabled={!room}
              onClick={guarded(() => engine.current.toggleMic())}
            />
            <IconButton
              icon={state.deafen ? HeadphoneOff : Headphones}
              label={`Весь звук · ${settings.hotkeys.deafen}`}
              active={state.deafen}
              disabled={!room}
              onClick={() => engine.current.toggleDeafen()}
            />
            <span className="control-divider" />
            <IconButton
              icon={state.camera ? Video : VideoOff}
              label={`Камера · ${settings.hotkeys.camera}`}
              active={state.camera}
              disabled={!room}
              onClick={guarded(() => engine.current.toggleCamera())}
            />
            <IconButton
              icon={MonitorUp}
              label={`Демонстрация · ${settings.hotkeys.screen}`}
              active={state.screen}
              disabled={!room}
              onClick={guarded(async () => {
                if (state.screen) await engine.current.stopShare();
                else {
                  refreshDevices();
                  setModal("share");
                }
              })}
            />
            <IconButton
              icon={AudioLines}
              label="Звуковая панель"
              active={dock === "sounds"}
              onClick={() => setDock(dock === "sounds" ? null : "sounds")}
            />
            <button
              className="hangup"
              disabled={!room}
              aria-label="Выйти из комнаты"
              title={
                room?.hosting ? "Закрыть комнату для всех" : "Выйти из комнаты"
              }
              onClick={guarded(async () => {
                await engine.current.leave();
                setMessages([]);
                setView("room");
              })}
            >
              <PhoneOff size={19} />
            </button>
            <IconButton
              icon={Music2}
              label="Музыка"
              active={dock === "music"}
              onClick={() => setDock(dock === "music" ? null : "music")}
            />
          </div>
          <div className="callbar-note">
            <ShieldCheck size={16} />
            <span>только свои</span>
          </div>
        </footer>
      </main>
      {session.peers.map((p) => (
        <React.Fragment key={p.id}>
          <Media
            stream={p.voiceStream}
            muted={state.deafen}
            volume={
              (settings.outputGain / 100) *
              ((volumes[p.id]?.voice ?? 100) / 100)
            }
            sink={settings.output}
          />
          <Media
            stream={p.screenStream}
            muted={state.deafen || !p.state.screen}
            volume={
              (settings.outputGain / 100) *
              ((volumes[p.id]?.screen ?? 100) / 100)
            }
            sink={settings.output}
          />
          <Media
            stream={p.musicStream}
            muted={state.deafen}
            volume={
              (settings.outputGain / 100) *
              ((volumes[p.id]?.music ?? 100) / 100)
            }
            sink={settings.output}
          />
        </React.Fragment>
      ))}
      {(modal === "host" || modal === "join") && (
        <RoomDialog
          mode={modal}
          profile={settings}
          initial={initialInvite}
          close={() => setModal(null)}
          enter={enter}
        />
      )}
      {editingSound && (
        <SoundEditor
          sound={editingSound}
          save={saveSound}
          close={() => setEditingSound(null)}
          notify={notify}
          volume={
            state.deafen
              ? 0
              : ((settings.soundGain / 100) * settings.outputGain) / 100
          }
        />
      )}
      {viewer &&
        (() => {
          if (viewer.file)
            return <MediaViewer {...viewer} close={() => setViewer(null)} />;
          const own = viewer.id === "self",
            peer = session.peers.find((p) => p.id === viewer.id);
          const stream = own
            ? viewer.kind === "camera"
              ? session.localCamera
              : session.localScreen
            : viewer.kind === "camera"
              ? peer?.cameraStream
              : peer?.screenStream;
          if (!stream) return null;
          return (
            <MediaViewer
              stream={stream}
              selected={viewer}
              soundPanel={
                <SoundDock
                  sounds={sounds}
                  add={setEditingSound}
                  edit={setEditingSound}
                  remove={removeSound}
                  play={guarded((sound, preview) =>
                    engine.current.playSound(sound, preview),
                  )}
                  stop={() => engine.current.stopSounds()}
                  room={room}
                  volume={settings.soundGain}
                  setVolume={(v) => quickSetting("soundGain", v)}
                />
              }
              focus={({ id, kind }) => setViewer({ id, kind })}
              controls={
                <div className="call-controls">
                  <IconButton
                    icon={state.mic ? Mic : MicOff}
                    label="Микрофон просмотра"
                    active={state.mic}
                    onClick={guarded(() => engine.current.toggleMic())}
                  />
                  <IconButton
                    icon={state.deafen ? HeadphoneOff : Headphones}
                    label="Наушники просмотра"
                    active={!state.deafen}
                    onClick={() => engine.current.toggleDeafen()}
                  />
                  <IconButton
                    icon={state.camera ? Video : VideoOff}
                    label="Камера просмотра"
                    active={state.camera}
                    onClick={guarded(() => engine.current.toggleCamera())}
                  />
                  <IconButton
                    icon={MonitorUp}
                    label="Демонстрация просмотра"
                    active={state.screen}
                    onClick={guarded(async () => {
                      if (state.screen) await engine.current.stopShare();
                      else {
                        refreshDevices();
                        setModal("share");
                      }
                    })}
                  />
                  <IconButton
                    icon={PhoneOff}
                    label="Выйти из звонка просмотра"
                    danger
                    onClick={guarded(() => engine.current.leave())}
                  />
                </div>
              }
              people={[
                {
                  ...settings,
                  id: "self",
                  own: true,
                  state,
                  cameraStream: session.localCamera,
                  screenStream: session.localScreen,
                },
                ...session.peers,
              ]}
              chat={chat}
              openProfile={showProfile}
              title={`${own ? settings.name : peer.name} · ${viewer.kind === "camera" ? "камера" : "демонстрация"}`}
              mirror={own && viewer.kind === "camera"}
              close={() => setViewer(null)}
            />
          );
        })()}
      {modal === "settings" && (
        <SettingsDialog
          initialTab={settingsTab}
          settings={settings}
          save={saveSettings}
          close={() => setModal(null)}
          devices={devices}
          refreshDevices={refreshDevices}
          notify={notify}
        />
      )}
      {personPopup &&
        (() => {
          const person =
            personPopup.id === "self"
              ? settings
              : session.peers.find((p) => p.id === personPopup.id);
          return (
            person && (
              <PersonPopover
                key={personPopup.id + personPopup.context}
                person={person}
                own={personPopup.id === "self"}
                {...personPopup}
                close={() => setPersonPopup(null)}
                expand={() => {
                  setProfileId(personPopup.id);
                  setPersonPopup(null);
                }}
                edit={() => {
                  setPersonPopup(null);
                  setSettingsTab("profile");
                  setModal("settings");
                }}
                volumes={volumes[personPopup.id] || {}}
                setVolume={(key, value) =>
                  updatePersonVolume(personPopup.id, key, value)
                }
              />
            )
          );
        })()}
      {profileId &&
        (() => {
          const person =
            profileId === "self"
              ? settings
              : session.peers.find((p) => p.id === profileId);
          return person ? (
            <ProfileDialog
              person={person}
              own={profileId === "self"}
              close={() => setProfileId(null)}
              edit={() => {
                setProfileId(null);
                setSettingsTab("profile");
                setModal("settings");
              }}
            />
          ) : (
            <Modal title="Участник вышел" close={() => setProfileId(null)}>
              <p>Профиль доступен, пока человек находится в комнате.</p>
            </Modal>
          );
        })()}
      {modal === "share" && (
        <ShareDialog
          close={() => setModal(null)}
          start={async (choice) => {
            const next = {
              ...settings,
              quality: choice.quality,
              streamMbps: choice.streamMbps,
            };
            await bridge.saveSettings(next);
            setSettings(next);
            await engine.current.applySettings(next);
            await engine.current.startShare(choice);
          }}
          devices={devices}
          quality={settings.quality}
          streamMbps={settings.streamMbps}
          viewers={session.peers?.length || 1}
          captureMode={settings.captureMode}
          notify={notify}
        />
      )}
      {modal === "invite" && room && (
        <Modal
          title="Пригласи друзей"
          subtitle="Приглашение даёт доступ к комнате. Отправляй его только своим."
          close={() => setModal(null)}
        >
          <div className="invite-code">{room.invite}</div>
          <button className="button primary full" onClick={copyInvite}>
            {copied ? <Check size={18} /> : <Copy size={18} />}{" "}
            {copied ? "Приглашение скопировано" : "Скопировать приглашение"}
          </button>
          <p className="notice">
            Другу нужно открыть Prestera, выбрать «К друзьям» и вставить
            приглашение. В одной сети всё готово. Для интернета создателю нужен
            доступный адрес и открытый порт TCP/UDP {room.port || "комнаты"}.
          </p>
          {room.hosting && (
            <p className="muted small">
              Комната закроется для всех, когда ты выйдешь.
            </p>
          )}
        </Modal>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            <Info size={17} />
            <span>{t.text}</span>
            <button
              aria-label="Скрыть уведомление"
              onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
