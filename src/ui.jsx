import React, { useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { safeAvatar } from "./media-utils";
const colors = [
  "#c3b3ea",
  "#e4b5bd",
  "#b4d1bc",
  "#e1c698",
  "#abc8df",
  "#c8bdd1",
];
export function IconButton({
  icon: Icon,
  label,
  active = false,
  danger = false,
  ...props
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""} ${danger ? "danger" : ""}`}
      title={label}
      aria-label={label}
      {...props}
    >
      <Icon size={19} />
    </button>
  );
}
export function Avatar({
  name,
  avatar,
  color = 0,
  big = false,
  talking = false,
  frame = "none",
  onClick,
}) {
  return (
    <div
      className={`avatar ${big ? "big" : ""} ${talking ? "talking" : ""} ${frame !== "none" ? "decorated" : ""}`}
      style={{ "--avatar": colors[color % colors.length] }}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `Открыть профиль ${name}` : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && ["Enter", " "].includes(e.key)) {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {safeAvatar(avatar) ? (
        <img src={avatar} alt={`Аватар ${name}`} />
      ) : (
        <span>{name?.slice(0, 1).toUpperCase() || "П"}</span>
      )}
      {["signal", "fracture", "orbit", "thorn", "pixel", "ghost"].includes(
        frame,
      ) && (
        <img
          className="avatar-frame"
          src={`frames/${frame}.svg`}
          alt=""
          aria-hidden="true"
        />
      )}
    </div>
  );
}
export function Modal({ title, subtitle, children, close, wide = false }) {
  const ref = useRef();
  useEffect(() => {
    const prior = document.activeElement;
    const el = ref.current;
    el.focus();
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
      if (e.key === "Tab") {
        const nodes = [
          ...el.querySelectorAll(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea, [tabindex="0"]',
          ),
        ].filter((n) => n.offsetParent);
        if (!nodes.length) return;
        if (e.shiftKey && document.activeElement === nodes[0]) {
          e.preventDefault();
          nodes.at(-1).focus();
        } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
          e.preventDefault();
          nodes[0].focus();
        }
      }
    };
    el.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("keydown", onKey);
      prior?.focus();
    };
  }, []);
  const content = (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <section
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? "wide" : ""}`}
      >
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton icon={X} label="Закрыть" onClick={close} />
        </header>
        {children}
      </section>
    </div>
  );
  return createPortal(content, document.fullscreenElement || document.body);
}
export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Toggle({ label, description, checked, onChange }) {
  return (
    <div className="toggle-row">
      <div>
        <b>{label}</b>
        <small>{description}</small>
      </div>
      <button
        role="switch"
        aria-label={label}
        aria-checked={checked}
        className={`toggle ${checked ? "on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <i />
      </button>
    </div>
  );
}
