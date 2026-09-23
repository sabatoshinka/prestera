import React from "react";

export function BitrateControl({
  value = 0,
  onChange,
  viewers = 1,
  defaultMbps = 10,
}) {
  const automatic = !Number(value);
  const mbps = automatic ? defaultMbps : Number(value);
  return (
    <div className="bitrate-control">
      <label className="slider">
        <span>
          Лимит битрейта стрима{" "}
          <b>{automatic ? `По качеству · ${defaultMbps}` : mbps} Мбит/с</b>
        </span>
        <input
          aria-label="Лимит битрейта стрима"
          type="range"
          min="1"
          max="50"
          step="1"
          value={mbps}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </label>
      <button
        type="button"
        className="text-button"
        disabled={automatic}
        onClick={() => onChange(0)}
      >
        Автоматически по выбранному качеству
      </button>
      <p className="muted small">
        Лимит на одного зрителя.{" "}
        {viewers > 1
          ? `Для ${viewers} зрителей — до ${mbps * viewers} Мбит/с исходящего видео. `
          : ""}
        Больше битрейт — больше деталей и расход трафика. При потерях сети поток
        может временно снижаться.
      </p>
    </div>
  );
}
