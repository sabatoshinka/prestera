import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Avatar, Modal, Field } from "./ui";
import {
  PRESENCES,
  FRAMES,
  profileData,
  safeBanner,
  prepareBanner,
} from "./profile-data";

export function ProfileCard({ person, own, edit }) {
  const p = profileData(person),
    banner = safeBanner(person.banner);
  return (
    <article
      className="profile-card"
      style={{ "--profile-color": p.profileColor }}
    >
      <div
        className={`profile-banner ${banner ? "" : "default-banner"}`}
        style={banner ? { backgroundImage: `url("${banner}")` } : {}}
      />
      <div className="profile-card-body">
        <div className="profile-identity">
          <Avatar {...p} big />
          <span
            className={`presence-dot ${p.presence}`}
            title={PRESENCES[p.presence]}
          />
        </div>
        {p.statusText && <p className="profile-status">{p.statusText}</p>}
        <h2>{p.name}</h2>
        <div className={`profile-presence ${p.presence}`}>
          <i />
          {PRESENCES[p.presence]}
        </div>
        <div className="profile-about">
          <small>ОБО МНЕ</small>
          <p>{p.bio || "Пока без описания. Просто свой человек."}</p>
        </div>
        {own && (
          <button className="button secondary full" onClick={edit}>
            Редактировать профиль
          </button>
        )}
      </div>
    </article>
  );
}
export function ProfileDialog({ person, own, edit, close }) {
  return (
    <Modal
      title={own ? "Твой профиль" : `Профиль ${person.name}`}
      close={close}
    >
      <div className="expanded-profile">
        <ProfileCard person={person} own={own} edit={edit} />
      </div>
    </Modal>
  );
}
export function PersonPopover({
  person,
  own,
  position,
  context,
  close,
  expand,
  edit,
  volumes,
  setVolume,
}) {
  const ref = useRef();
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    const outside = (e) => {
      if (!ref.current?.contains(e.target)) close();
    };
    const key = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key, true);
      previous?.focus?.({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <section
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-label={
        context ? `Громкость ${person.name}` : `Карточка ${person.name}`
      }
      className="person-popover"
      style={{
        left: Math.max(8, Math.min(position.x, window.innerWidth - 322)),
        top: Math.max(8, Math.min(position.y, window.innerHeight - 500)),
      }}
    >
      <button
        className="popover-close"
        aria-label="Закрыть карточку"
        onClick={close}
      >
        <X size={16} strokeWidth={1.8} />
      </button>
      {context ? (
        <h3>{person.name}</h3>
      ) : (
        <ProfileCard person={person} own={false} />
      )}
      {!own && (
        <div className="person-mixer">
          {[
            ["voice", "Голос"],
            ["music", "Музыка"],
            ["screen", "Звук демонстрации"],
          ].map(([key, label]) => (
            <label className="slider" key={key}>
              <span>
                {label}
                <b>{volumes[key] ?? 100}%</b>
              </span>
              <input
                aria-label={`${label} ${person.name}`}
                type="range"
                min="0"
                max="100"
                value={volumes[key] ?? 100}
                onChange={(e) => setVolume(key, +e.target.value)}
              />
            </label>
          ))}
          <small>Громкость меняется только у тебя.</small>
        </div>
      )}
      <button className="button secondary full" onClick={expand}>
        Открыть профиль
      </button>
      {own && (
        <button className="text-button" onClick={edit}>
          Редактировать профиль
        </button>
      )}
    </section>,
    document.fullscreenElement || document.body,
  );
}
export function ProfileSettings({ draft, set, notify }) {
  return (
    <section className="profile-customization">
      <h3>Профиль для друзей</h3>
      <Field label="Статус присутствия">
        <select
          aria-label="Статус присутствия"
          value={draft.presence || "online"}
          onChange={(e) => set("presence", e.target.value)}
        >
          {Object.entries(PRESENCES).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Текстовый статус">
        <input
          aria-label="Текстовый статус"
          maxLength={100}
          value={draft.statusText || ""}
          onChange={(e) => set("statusText", e.target.value)}
          placeholder="Слушаю музыку"
        />
      </Field>
      <Field label="Обо мне">
        <textarea
          aria-label="Обо мне"
          rows={4}
          maxLength={600}
          value={draft.bio || ""}
          onChange={(e) => set("bio", e.target.value)}
        />
      </Field>
      <Field label="Цвет профиля">
        <input
          type="color"
          value={draft.profileColor || "#8773ab"}
          onChange={(e) => set("profileColor", e.target.value)}
        />
      </Field>
      <div className="editor-actions">
        <label className="button secondary">
          Выбрать баннер
          <input
            hidden
            type="file"
            aria-label="Выбрать баннер"
            accept="image/*"
            onChange={async (e) => {
              const file = e.target.files[0];
              e.target.value = "";
              if (file)
                try {
                  set("banner", await prepareBanner(file));
                } catch (error) {
                  notify(error.message);
                }
            }}
          />
        </label>
        <button className="text-button" onClick={() => set("banner", "")}>
          Убрать баннер
        </button>
      </div>
      <h4>Рамки · SIGNAL / NOISE</h4>
      <p className="muted small">
        Глитч, пиксели и холодный свет. Рамки видят все участники.
      </p>
      <div className="frame-picker">
        {Object.entries(FRAMES).map(([key, label]) => (
          <button
            key={key}
            aria-label={`Рамка ${label}`}
            aria-pressed={(draft.frame || "none") === key}
            className={(draft.frame || "none") === key ? "selected" : ""}
            onClick={() => set("frame", key)}
          >
            <Avatar name={draft.name} avatar={draft.avatar} frame={key} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <ProfileCard person={draft} />
      <p className="notice">
        Профиль обновляется у друзей сразу после сохранения. «Оффлайн» меняет
        индикатор, но участники всё равно видят тебя в звонке.
      </p>
    </section>
  );
}
