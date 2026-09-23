import React, { useEffect, useRef, useState } from "react";
import {
  X,
  Maximize2,
  Minimize2,
  Plus,
  Minus,
  Download,
  Play,
  Pause,
  Square,
  Trash2,
  Pencil,
  AudioLines,
  Music2,
  SkipForward,
  SkipBack,
  ExternalLink,
  Check,
  Scissors,
  Users,
  MessageCircle,
  MicOff,
  Move,
  RotateCcw,
} from "lucide-react";
import { IconButton, Modal, Field, Toggle, Avatar } from "./ui";
import { prepareImage, trimToWav, spotifyUrl, timeLabel } from "./media-utils";
import { PlaylistLibrary } from "./playlists";

function ViewerPerson({ person, openProfile, focus }) {
  const video = useRef();
  useEffect(() => {
    if (video.current) {
      video.current.srcObject = person.cameraStream;
      video.current.play().catch(() => {});
    }
  }, [person.cameraStream, person.state.camera]);
  return (
    <button
      className={`viewer-person ${person.state.talking ? "speaking" : ""}`}
      data-person={person.own ? "self" : person.id}
      aria-label={
        person.state.camera
          ? `Смотреть камеру ${person.name}`
          : `Профиль ${person.name}`
      }
      onClick={() =>
        person.state.camera
          ? focus({ id: person.own ? "self" : person.id, kind: "camera" })
          : openProfile(person.own ? "self" : person.id)
      }
    >
      {person.state.camera ? (
        <video ref={video} autoPlay muted playsInline />
      ) : (
        <Avatar {...person} />
      )}
      <span>
        {person.name}
        {!person.state.mic && <MicOff size={12} />}
      </span>
    </button>
  );
}
function FloatingVideo({ item, index, focus, hidden }) {
  const box = useRef(),
    video = useRef(),
    gesture = useRef();
  const [rect, setRect] = useState({
    x: 18 + (index % 3) * 28,
    y: 78 + (index % 5) * 30,
    w: 240,
    h: 160,
  });
  const clamp = (r) => {
    const parent = box.current?.parentElement;
    const width = parent?.clientWidth || 800,
      height = parent?.clientHeight || 600;
    const w = Math.min(Math.max(140, r.w), width),
      h = Math.min(Math.max(96, r.h), height);
    return {
      w,
      h,
      x: Math.max(0, Math.min(r.x, width - w)),
      y: Math.max(0, Math.min(r.y, height - h)),
    };
  };
  useEffect(() => {
    video.current.srcObject = item.stream;
    video.current.play().catch(() => {});
    return () => {
      if (video.current) video.current.srcObject = null;
    };
  }, [item.stream]);
  useEffect(() => {
    const observer = new ResizeObserver(() => setRect((r) => clamp(r)));
    observer.observe(box.current.parentElement);
    return () => observer.disconnect();
  }, []);
  const start = (e, resize) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = {
      x: e.clientX,
      y: e.clientY,
      rect,
      resize,
      moved: false,
    };
  };
  const move = (e) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x,
      dy = e.clientY - g.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) g.moved = true;
    setRect(
      clamp(
        g.resize
          ? { ...g.rect, w: g.rect.w + dx, h: g.rect.h + dy }
          : { ...g.rect, x: g.rect.x + dx, y: g.rect.y + dy },
      ),
    );
  };
  const finish = () => {
    gesture.current = null;
  };
  return (
    <article
      ref={box}
      className={`floating-video ${item.talking ? "speaking" : ""}`}
      data-person={item.id}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        display: hidden ? "none" : undefined,
      }}
    >
      <button
        className="floating-focus"
        aria-label={`Сфокусироваться: ${item.title}`}
        onClick={() => focus(item)}
      >
        <video
          ref={video}
          muted
          autoPlay
          playsInline
          className={item.mirror ? "mirror" : ""}
        />
      </button>
      <div
        className="floating-handle"
        onPointerDown={(e) => start(e, false)}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <Move size={14} />
        <span>{item.title}</span>
      </div>
      <button
        className="floating-resize"
        aria-label={`Изменить размер: ${item.title}`}
        title="Потяни за угол, чтобы изменить размер"
        onPointerDown={(e) => start(e, true)}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
        onKeyDown={(e) => {
          if (
            !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
          )
            return;
          e.preventDefault();
          setRect((r) =>
            clamp({
              ...r,
              w:
                r.w +
                (e.key === "ArrowRight" ? 20 : e.key === "ArrowLeft" ? -20 : 0),
              h:
                r.h +
                (e.key === "ArrowDown" ? 20 : e.key === "ArrowUp" ? -20 : 0),
            }),
          );
        }}
      >
        ◢
      </button>
    </article>
  );
}
export function MediaViewer({
  file,
  stream,
  title,
  mirror,
  save,
  close,
  controls,
  soundPanel,
  people = [],
  chat,
  openProfile,
  children,
  focus,
  selected,
}) {
  const ref = useRef(),
    media = useRef();
  const [url, setUrl] = useState(""),
    [zoom, setZoom] = useState(1),
    [full, setFull] = useState(false);
  const [awake, setAwake] = useState(true),
    [chatOpen, setChatOpen] = useState(false),
    [peopleOpen, setPeopleOpen] = useState(true);
  const [attachment, setAttachment] = useState(null);
  const [soundsOpen, setSoundsOpen] = useState(false);
  const [layout, setLayout] = useState(0);
  const floating = people.flatMap((p) => [
    ...(p.state.camera && p.cameraStream
      ? [
          {
            id: p.own ? "self" : p.id,
            kind: "camera",
            stream: p.cameraStream,
            title: `${p.name} · камера`,
            mirror: p.own,
            talking: p.state.talking,
          },
        ]
      : []),
    ...(p.state.screen && p.screenStream
      ? [
          {
            id: p.own ? "self" : p.id,
            kind: "screen",
            stream: p.screenStream,
            title: `${p.name} · демонстрация`,
            talking: p.state.talking,
          },
        ]
      : []),
  ]);
  const idle = useRef();
  const wake = () => {
    setAwake(true);
    clearTimeout(idle.current);
    if (!file && !chatOpen && !soundsOpen)
      idle.current = setTimeout(() => {
        if (
          ref.current?.querySelector(
            "header:hover, .viewer-bottom:hover, .viewer-chat:hover, .floating-video:hover",
          )
        ) {
          wake();
          return;
        }
        if (
          !ref.current?.querySelector(".modal-backdrop, .person-popover") &&
          !["INPUT", "TEXTAREA", "SELECT"].includes(
            document.activeElement?.tagName,
          )
        ) {
          ref.current?.focus({ preventScroll: true });
          setAwake(false);
        }
      }, 3200);
  };
  useEffect(() => {
    wake();
    return () => clearTimeout(idle.current);
  }, [file, chatOpen, soundsOpen]);
  useEffect(() => {
    const el = ref.current;
    el.focus();
    if (file) {
      const next = URL.createObjectURL(file.blob);
      setUrl(next);
      return () => URL.revokeObjectURL(next);
    }
    media.current.srcObject = stream;
    media.current.play().catch(() => {});
    return () => {
      if (media.current) media.current.srcObject = null;
    };
  }, [file, stream]);
  useEffect(() => {
    const el = ref.current;
    return () => {
      if (document.fullscreenElement === el)
        document.exitFullscreen().catch(() => {});
    };
  }, []);
  useEffect(() => {
    const change = () => setFull(document.fullscreenElement === ref.current);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  return (
    <section
      ref={ref}
      className={`media-viewer ${file ? "" : "stream-viewer"} ${awake ? "" : "idle"} ${chatOpen ? "with-chat" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
      onPointerMove={wake}
      onPointerDown={wake}
      onFocusCapture={wake}
      onKeyDown={(e) => {
        wake();
        if (e.key === "Escape") {
          e.stopPropagation();
          if (soundsOpen) setSoundsOpen(false);
          else if (document.fullscreenElement === ref.current)
            document.exitFullscreen().catch(() => {});
          else close();
        }
      }}
    >
      <header>
        <b>{title}</b>
        <div>
          {!file && (
            <>
              <IconButton
                icon={RotateCcw}
                label="Сбросить расположение мини-окон"
                onClick={() => setLayout((v) => v + 1)}
              />
              <IconButton
                icon={Users}
                label={peopleOpen ? "Скрыть участников" : "Показать участников"}
                active={peopleOpen}
                onClick={() => setPeopleOpen((v) => !v)}
              />
              <IconButton
                icon={MessageCircle}
                label={
                  chatOpen ? "Закрыть чат просмотра" : "Открыть чат просмотра"
                }
                active={chatOpen}
                onClick={() => setChatOpen((v) => !v)}
              />
            </>
          )}
          {file && (
            <>
              <IconButton
                icon={Minus}
                label="Уменьшить изображение"
                onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
              />
              <button className="text-button" onClick={() => setZoom(1)}>
                {Math.round(zoom * 100)}%
              </button>
              <IconButton
                icon={Plus}
                label="Увеличить изображение"
                onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
              />
              <IconButton
                icon={Download}
                label="Скачать изображение"
                onClick={save}
              />
            </>
          )}
          <IconButton
            icon={full ? Minimize2 : Maximize2}
            label={full ? "Выйти из полноэкранного режима" : "На весь экран"}
            onClick={() =>
              (full
                ? document.exitFullscreen()
                : ref.current.requestFullscreen()
              ).catch(() => {})
            }
          />
          <IconButton icon={X} label="Закрыть просмотр" onClick={close} />
        </div>
      </header>
      <div
        className={`viewer-content ${file ? "viewer-image" : ""} ${zoom > 1 ? "zoomed" : ""}`}
        onDoubleClick={() => file && setZoom((z) => (z === 1 ? 2 : 1))}
      >
        {file ? (
          <img
            src={url}
            alt={file.name}
            style={{
              width: zoom === 1 ? undefined : `${zoom * 90}%`,
              maxWidth: zoom > 1 ? "none" : undefined,
              maxHeight: zoom > 1 ? "none" : undefined,
            }}
          />
        ) : (
          <video
            ref={media}
            autoPlay
            playsInline
            muted
            className={mirror ? "mirror" : ""}
          />
        )}
        {!file &&
          focus &&
          floating.map((item, index) => (
            <FloatingVideo
              key={`${layout}:${item.id}:${item.kind}`}
              item={item}
              index={index}
              focus={focus}
              hidden={
                !peopleOpen ||
                (selected?.id === item.id && selected?.kind === item.kind)
              }
            />
          ))}
      </div>
      {!file && (
        <>
          <div className="viewer-bottom">
            {soundsOpen && soundPanel && (
              <div className="viewer-sounds">
                {React.cloneElement(soundPanel, {
                  close: () => setSoundsOpen(false),
                })}
              </div>
            )}
            {peopleOpen && (
              <div className="viewer-people">
                {people.map((p) => (
                  <ViewerPerson
                    key={p.id}
                    person={p}
                    openProfile={openProfile}
                    focus={focus}
                  />
                ))}
              </div>
            )}
            <div className="viewer-controls">
              {controls}
              {soundPanel && (
                <IconButton
                  icon={AudioLines}
                  label={
                    soundsOpen
                      ? "Закрыть звуки просмотра"
                      : "Звуковая панель просмотра"
                  }
                  active={soundsOpen}
                  onClick={() => setSoundsOpen((v) => !v)}
                />
              )}
            </div>
          </div>
          {chatOpen && (
            <aside className="viewer-chat">
              {React.cloneElement(chat, { openMedia: setAttachment })}
            </aside>
          )}
        </>
      )}
      {attachment && (
        <MediaViewer {...attachment} close={() => setAttachment(null)} />
      )}
      {children}
    </section>
  );
}

export function SoundDock({
  sounds,
  add,
  edit,
  remove,
  play,
  stop,
  room,
  volume,
  setVolume,
  close,
}) {
  const input = useRef();
  return (
    <section className="call-dock" aria-label="Панель звуков" role="dialog">
      <header>
        <div>
          <AudioLines size={19} />
          <b>Звуковая панель</b>
        </div>
        <IconButton icon={X} label="Закрыть панель звуков" onClick={close} />
      </header>
      <label className="slider">
        <span>
          Громкость звуков<b>{volume}%</b>
        </span>
        <input
          aria-label="Громкость звуков"
          type="range"
          min="0"
          max="100"
          value={volume}
          onChange={(e) => setVolume(+e.target.value)}
        />
      </label>
      <div className="dock-sounds">
        {sounds.map((sound, i) => (
          <article key={sound.id}>
            <button
              className="dock-sound-play"
              disabled={!room}
              onClick={() => play(sound)}
            >
              <span>
                <AudioLines size={19} />
              </span>
              <b>{sound.name}</b>
              <small>
                {sound.duration
                  ? `${sound.duration.toFixed(1)} сек`
                  : "Короткий звук"}
                {i < 3 ? ` · ${i + 1}` : ""}
              </small>
            </button>
            <div>
              <IconButton
                icon={Play}
                label={`Прослушать ${sound.name}`}
                onClick={() => play(sound, true)}
              />
              <IconButton
                icon={Pencil}
                label={`Редактировать ${sound.name}`}
                onClick={() => edit(sound)}
              />
              <IconButton
                icon={Trash2}
                label={`Удалить ${sound.name}`}
                onClick={() => remove(sound.id)}
              />
            </div>
          </article>
        ))}
      </div>
      <footer>
        <button
          className="button secondary"
          onClick={() => input.current.click()}
        >
          <Plus size={16} /> Добавить и обрезать
        </button>
        <button className="text-button" onClick={stop}>
          <Square size={14} /> Стоп
        </button>
      </footer>
      <small className="muted">
        Карточка — сыграть в комнате. Треугольник — послушать у себя.
      </small>
      <input
        ref={input}
        aria-label="Добавить звук"
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => {
          const file = e.target.files[0];
          e.target.value = "";
          if (file) add(file);
        }}
      />
    </section>
  );
}

export function SoundEditor({ sound, save, close, notify, volume = 0.5 }) {
  const [buffer, setBuffer] = useState(null),
    [start, setStart] = useState(0),
    [end, setEnd] = useState(1),
    [name, setName] = useState(sound.name.replace(/\.[^.]+$/, "")),
    [busy, setBusy] = useState(false),
    [playing, setPlaying] = useState(false),
    [error, setError] = useState("");
  const canvas = useRef(),
    context = useRef(),
    source = useRef();
  const stop = () => {
    try {
      source.current?.stop();
    } catch {}
    source.current = null;
    setPlaying(false);
  };
  useEffect(() => {
    const ctx = new AudioContext({ sampleRate: 48000 });
    context.current = ctx;
    let cancelled = false;
    (async () => {
      const blob = sound.blob || sound;
      if (blob.size > 40 * 1024 * 1024)
        throw new Error("Исходная запись должна быть меньше 40 МБ");
      const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
      if (audio.duration > 600)
        throw new Error("Для звуковой панели выбери исходник до 10 минут");
      if (!cancelled) {
        setBuffer(audio);
        setEnd(Math.min(30, audio.duration));
      }
    })().catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
      try {
        source.current?.stop();
      } catch {}
      ctx.close();
    };
  }, [sound]);
  useEffect(() => {
    if (!buffer) return;
    const c = canvas.current,
      g = c.getContext("2d"),
      samples = buffer.getChannelData(0);
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = "#24212d";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#c5b5e832";
    g.fillRect(
      (start / buffer.duration) * c.width,
      0,
      ((end - start) / buffer.duration) * c.width,
      c.height,
    );
    for (let x = 0; x < c.width; x++) {
      const a = Math.floor((x / c.width) * samples.length),
        b = Math.floor(((x + 1) / c.width) * samples.length);
      let peak = 0;
      for (let i = a; i < b; i += Math.max(1, Math.floor((b - a) / 60)))
        peak = Math.max(peak, Math.abs(samples[i]));
      g.fillStyle =
        x >= (start / buffer.duration) * c.width &&
        x <= (end / buffer.duration) * c.width
          ? "#d2c0f6"
          : "#666170";
      g.fillRect(x, 70 - peak * 62, 1, Math.max(1, peak * 124));
    }
  }, [buffer, start, end]);
  const valid =
    buffer &&
    end > start &&
    end - start <= 30.001 &&
    end <= buffer.duration &&
    start >= 0;
  return (
    <Modal
      title="Редактор звука"
      subtitle="Выбери фрагмент до 30 секунд и послушай перед сохранением."
      close={close}
      wide
    >
      <Field label="Название звука">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
        />
      </Field>
      {error ? (
        <p role="alert" className="notice">
          {error}
        </p>
      ) : !buffer ? (
        <p>Читаем аудио…</p>
      ) : (
        <>
          <canvas
            className="waveform"
            ref={canvas}
            width="800"
            height="140"
            aria-label="Волна звука и выбранный фрагмент"
          />
          <div className="two-fields">
            {[
              ["Начало, сек", start, setStart],
              ["Конец, сек", end, setEnd],
            ].map(([label, value, set]) => (
              <Field key={label} label={label}>
                <input
                  type="number"
                  min="0"
                  max={buffer.duration}
                  step="0.01"
                  value={value}
                  onChange={(e) => {
                    stop();
                    set(+e.target.value);
                  }}
                />
                <input
                  type="range"
                  aria-label={label + " — ползунок"}
                  min="0"
                  max={buffer.duration}
                  step="0.01"
                  value={value}
                  onChange={(e) => {
                    stop();
                    set(+e.target.value);
                  }}
                />
              </Field>
            ))}
          </div>
          <p className="trim-summary">
            Выбрано: <b>{Math.max(0, end - start).toFixed(2)} сек</b> из{" "}
            {timeLabel(buffer.duration)}
            {!valid && " · нужен фрагмент от 0,05 до 30 секунд"}
          </p>
          <div className="editor-actions">
            <button
              className="button secondary"
              disabled={!valid || end - start < 0.05}
              onClick={async () => {
                if (playing) return stop();
                await context.current.resume();
                const node = context.current.createBufferSource(),
                  gain = context.current.createGain();
                node.buffer = buffer;
                gain.gain.value = volume;
                node.connect(gain).connect(context.current.destination);
                source.current = node;
                node.onended = () => {
                  node.disconnect();
                  gain.disconnect();
                  setPlaying(false);
                };
                node.start(0, start, end - start);
                setPlaying(true);
              }}
            >
              {playing ? <Square size={16} /> : <Play size={16} />}{" "}
              {playing ? "Остановить" : "Прослушать фрагмент"}
            </button>
            <button
              className="button primary"
              disabled={!valid || busy || !name.trim()}
              onClick={async () => {
                setBusy(true);
                stop();
                try {
                  await save({
                    id: sound.id || crypto.randomUUID(),
                    name: name.trim(),
                    blob: trimToWav(buffer, start, end),
                    duration: end - start,
                    created: sound.created || Date.now(),
                  });
                  close();
                } catch (e) {
                  notify(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Scissors size={16} />{" "}
              {busy ? "Сохраняем…" : "Сохранить фрагмент"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

export function AppearanceSettings({ draft, set, notify }) {
  const load = async (e, avatar) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      set(avatar ? "avatar" : "background", await prepareImage(file, avatar));
    } catch (error) {
      notify(error.message);
    }
  };
  return (
    <div className="appearance-settings">
      <div className="avatar-editor">
        <Avatar
          name={draft.name}
          avatar={draft.avatar}
          color={draft.color}
          big
        />
        <div>
          <label className="button secondary">
            Выбрать аватар
            <input
              aria-label="Выбрать аватар"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              hidden
              onChange={(e) => load(e, true)}
            />
          </label>
          <button
            className="text-button"
            disabled={!draft.avatar}
            onClick={() => set("avatar", "")}
          >
            Убрать аватар
          </button>
        </div>
      </div>
      <Field label="Цвет оформления">
        <input
          type="color"
          value={draft.accent || "#c5b5e8"}
          onChange={(e) => set("accent", e.target.value)}
        />
      </Field>
      <div
        className="background-preview"
        style={
          draft.background
            ? {
                backgroundImage: `linear-gradient(#17161b55,#17161b99),url("${draft.background}")`,
              }
            : {}
        }
      >
        <span style={{ color: draft.accent }}>Твой цвет. Твоё настроение.</span>
      </div>
      <div className="editor-actions">
        <label className="button secondary">
          Выбрать фон
          <input
            aria-label="Выбрать фон"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
            hidden
            onChange={(e) => load(e, false)}
          />
        </label>
        <button className="text-button" onClick={() => set("background", "")}>
          Убрать фон
        </button>
      </div>
      <label className="slider">
        <span>
          Затемнение фона<b>{draft.backgroundDim ?? 75}%</b>
        </span>
        <input
          aria-label="Затемнение фона"
          type="range"
          min="20"
          max="95"
          value={draft.backgroundDim ?? 75}
          onChange={(e) => set("backgroundDim", +e.target.value)}
        />
      </label>
      <p className="notice">
        Аватар виден друзьям в комнате. Фон и цвет оформления меняются только у
        тебя.
      </p>
    </div>
  );
}

export function MicrophoneSettings({ draft, set, notify }) {
  const [testing, setTesting] = useState(false),
    [level, setLevel] = useState(-96),
    [opened, setOpened] = useState(false);
  const monitor = useRef(),
    active = useRef(false);
  const stop = () => {
    active.current = false;
    monitor.current?.stream.getTracks().forEach((t) => t.stop());
    monitor.current?.ctx.close();
    monitor.current = null;
    setTesting(false);
    setLevel(-96);
  };
  useEffect(
    () => () => {
      active.current = false;
      monitor.current?.stream.getTracks().forEach((t) => t.stop());
      monitor.current?.ctx.close();
    },
    [],
  );
  useEffect(() => {
    if (monitor.current)
      monitor.current.filter.frequency.value =
        draft.noiseMode === "voice" ? 100 : 0;
    monitor.current?.gate.port.postMessage({
      enabled: draft.gateEnabled,
      threshold: draft.gateThreshold,
      hold: draft.gateHold,
    });
    const track = monitor.current?.stream.getAudioTracks()[0];
    track
      ?.applyConstraints({
        noiseSuppression: draft.noiseMode !== "off",
        echoCancellation: draft.echo,
        autoGainControl: draft.autoGain,
      })
      .catch(() => {});
  }, [
    draft.gateEnabled,
    draft.gateThreshold,
    draft.gateHold,
    draft.noiseMode,
    draft.echo,
    draft.autoGain,
  ]);
  return (
    <>
      <Field label="Обработка фонового шума">
        <select
          value={draft.noiseMode || (draft.noise ? "standard" : "off")}
          onChange={(e) => {
            set("noiseMode", e.target.value);
          }}
        >
          <option value="off">Без шумоподавления</option>
          <option value="standard">Стандартное WebRTC</option>
          <option value="voice">WebRTC + фильтр низкого гула</option>
        </select>
      </Field>
      <Toggle
        label="Автоматическое усиление"
        description="Выравнивает громкость микрофона."
        checked={draft.autoGain ?? true}
        onChange={(v) => set("autoGain", v)}
      />
      <Toggle
        label="Отсекать тихие звуки"
        description="Микрофон пропускает звук, когда уровень превышает порог."
        checked={draft.gateEnabled ?? false}
        onChange={(v) => set("gateEnabled", v)}
      />
      <label className="slider">
        <span>
          Порог срабатывания<b>{draft.gateThreshold ?? -52} дБ</b>
        </span>
        <input
          aria-label="Порог срабатывания"
          type="range"
          min="-80"
          max="-10"
          value={draft.gateThreshold ?? -52}
          onChange={(e) => set("gateThreshold", +e.target.value)}
        />
      </label>
      <label className="slider">
        <span>
          Задержка закрытия после речи<b>{draft.gateHold ?? 250} мс</b>
        </span>
        <input
          aria-label="Задержка закрытия"
          type="range"
          min="50"
          max="1000"
          step="25"
          value={draft.gateHold ?? 250}
          onChange={(e) => set("gateHold", +e.target.value)}
        />
      </label>
      <div className="mic-meter" aria-label="Уровень микрофона">
        <i
          style={{
            width: `${Math.max(0, ((level + 80) / 80) * 100)}%`,
            background: opened ? "#9ccbb2" : "#c5b5e8",
          }}
        />
        <span
          style={{
            left: `${(((draft.gateThreshold ?? -52) + 80) / 80) * 100}%`,
          }}
        />
      </div>
      <div className="mic-test-row">
        <button
          className="button secondary"
          onClick={async () => {
            if (testing) return stop();
            active.current = true;
            setTesting(true);
            let stream, ctx;
            try {
              stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                  deviceId: draft.mic ? { exact: draft.mic } : undefined,
                  noiseSuppression: draft.noiseMode !== "off",
                  echoCancellation: draft.echo,
                  autoGainControl: draft.autoGain,
                },
                video: false,
              });
              if (!active.current) {
                stream.getTracks().forEach((t) => t.stop());
                return;
              }
              ctx = new AudioContext({ sampleRate: 48000 });
              await ctx.audioWorklet.addModule("voice-gate-worklet.js");
              if (!active.current) {
                stream.getTracks().forEach((t) => t.stop());
                await ctx.close();
                return;
              }
              const gate = new AudioWorkletNode(ctx, "pibble-voice-gate"),
                filter = ctx.createBiquadFilter(),
                silent = ctx.createGain();
              filter.type = "highpass";
              filter.frequency.value = draft.noiseMode === "voice" ? 100 : 0;
              silent.gain.value = 0;
              ctx
                .createMediaStreamSource(stream)
                .connect(filter)
                .connect(gate)
                .connect(silent)
                .connect(ctx.destination);
              gate.port.onmessage = ({ data }) => {
                setLevel(data.db);
                setOpened(data.open);
              };
              gate.port.postMessage({
                enabled: draft.gateEnabled,
                threshold: draft.gateThreshold,
                hold: draft.gateHold,
              });
              monitor.current = { ctx, stream, gate, filter };
              await ctx.resume();
            } catch (e) {
              stream?.getTracks().forEach((t) => t.stop());
              ctx?.close();
              stop();
              notify(e.message);
            }
          }}
        >
          {testing ? "Остановить проверку" : "Проверить микрофон"}
        </button>
        <small>
          {testing
            ? `${Math.round(level)} дБ · ${opened ? "звук проходит" : "ниже порога"}`
            : "Проверка показывает уровень без воспроизведения голоса."}
        </small>
      </div>
    </>
  );
}

export function MusicDock({
  engine,
  music,
  room,
  peers,
  settings,
  setVolume,
  close,
  notify,
}) {
  const input = useRef();
  const [tab, setTab] = useState("room"),
    [link, setLink] = useState(""),
    [spotify, setSpotify] = useState(null);
  const run = (action) =>
    Promise.resolve()
      .then(action)
      .catch((e) => notify(e.message));
  return (
    <section
      className="call-dock music-dock"
      aria-label="Музыкальный плеер"
      role="dialog"
    >
      <header>
        <div>
          <Music2 size={19} />
          <b>Музыка</b>
        </div>
        <IconButton icon={X} label="Закрыть музыку" onClick={close} />
      </header>
      <div className="settings-tabs">
        <button
          className={tab === "room" ? "selected" : ""}
          onClick={() => setTab("room")}
        >
          Для комнаты
        </button>
        <button
          className={tab === "spotify" ? "selected" : ""}
          onClick={() => setTab("spotify")}
        >
          Spotify · у себя
        </button>
      </div>
      <div hidden={tab !== "spotify"}>
        <Field label="Ссылка Spotify">
          <input
            placeholder="https://open.spotify.com/playlist/…"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
        </Field>
        <button
          className="button secondary"
          onClick={() => {
            const value = spotifyUrl(link);
            if (!value)
              return notify(
                "Нужна ссылка Spotify на трек, альбом, исполнителя или плейлист",
              );
            setSpotify(value);
          }}
        >
          Открыть плеер
        </button>
        {spotify && (
          <>
            <iframe
              title="Spotify"
              src={spotify.embed}
              width="100%"
              height="352"
              allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
              sandbox="allow-scripts allow-same-origin allow-popups"
              referrerPolicy="no-referrer"
            />
            <button
              className="text-button"
              onClick={() => run(() => window.pibble.openSpotify(spotify.url))}
            >
              <ExternalLink size={15} /> Открыть Spotify в браузере
            </button>
          </>
        )}
        <p className="notice">
          Spotify играет только у тебя. Полные треки зависят от Spotify и
          аккаунта; здесь может быть доступен только фрагмент. Общий плеер
          находится на вкладке «Для комнаты».
        </p>
      </div>
      <div hidden={tab !== "room"}>
        <PlaylistLibrary engine={engine} notify={notify} />
        <p className="music-now">
          {music?.queue?.[music.index]?.name || "Собери свой плейлист"}
        </p>
        <div className="music-transport">
          <IconButton
            icon={SkipBack}
            label="Предыдущий трек"
            disabled={!music?.queue?.length || !room}
            onClick={() => run(() => engine.musicNext(-1))}
          />
          <IconButton
            icon={music?.playing ? Pause : Play}
            label={music?.playing ? "Пауза музыки" : "Включить музыку"}
            disabled={!music?.queue?.length || !room}
            onClick={() => run(() => engine.musicToggle())}
          />
          <IconButton
            icon={SkipForward}
            label="Следующий трек"
            disabled={!music?.queue?.length || !room}
            onClick={() => run(() => engine.musicNext(1))}
          />
          <IconButton
            icon={Square}
            label="Остановить музыку"
            onClick={() => engine.stopMusic()}
          />
          <span>
            {timeLabel(music?.position)} / {timeLabel(music?.duration)}
          </span>
        </div>
        <input
          aria-label="Позиция музыки"
          type="range"
          min="0"
          max={music?.duration || 1}
          step="0.1"
          value={music?.position || 0}
          disabled={!music?.duration}
          onChange={(e) => engine.musicSeek(+e.target.value)}
        />
        <label className="slider">
          <span>
            Громкость музыки<b>{settings.musicGain ?? 65}%</b>
          </span>
          <input
            aria-label="Громкость музыки"
            type="range"
            min="0"
            max="100"
            value={settings.musicGain ?? 65}
            onChange={(e) => setVolume(+e.target.value)}
          />
        </label>
        <div className="music-queue">
          {music?.queue?.map((track, i) => (
            <div key={track.id} className={i === music.index ? "selected" : ""}>
              <button
                disabled={!room}
                onClick={() => run(() => engine.musicPlay(i))}
              >
                {i === music.index && music.playing ? (
                  <AudioLines size={16} />
                ) : (
                  <Music2 size={16} />
                )}
                <span>{track.name}</span>
              </button>
              <IconButton
                icon={Trash2}
                label={`Убрать ${track.name}`}
                onClick={() => engine.musicRemove(i)}
              />
            </div>
          ))}
        </div>
        <button
          className="button secondary"
          onClick={() => input.current.click()}
        >
          <Plus size={16} /> Добавить музыку
        </button>
        <input
          hidden
          ref={input}
          aria-label="Добавить музыку"
          type="file"
          accept="audio/*"
          multiple
          onChange={(e) => {
            const files = [...e.target.files];
            e.target.value = "";
            run(() => engine.musicAdd(files));
          }}
        />
        <p className="notice">
          Твои аудиофайлы играют у всех участников комнаты, даже с выключенным
          микрофоном. Управляет тот, кто включил музыку. Очередь хранится до
          закрытия приложения.
        </p>
        {peers
          .filter((p) => p.music?.playing)
          .map((p) => (
            <p className="remote-music" key={p.id}>
              <Music2 size={15} /> {p.name}: {p.music.title}
            </p>
          ))}
      </div>
    </section>
  );
}
