import { safeAvatar } from "./media-utils.js";
export const PRESENCES = {
  online: "В сети",
  away: "Нет на месте",
  busy: "Не беспокоить",
  offline: "Оффлайн",
};
export const FRAMES = {
  none: "Без рамки",
  signal: "Сигнал",
  fracture: "Разлом",
  orbit: "Орбита",
  thorn: "Шипы",
  pixel: "Пиксель",
  ghost: "Призрак",
};
export const safeBanner = (value) =>
  typeof value === "string" &&
  value.length <= 60000 &&
  /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)
    ? value
    : "";
export function profileData(value = {}) {
  return {
    name: String(value.name || "Участник").slice(0, 32),
    color: Math.max(0, Math.min(5, Math.floor(Number(value.color) || 0))),
    avatar: safeAvatar(value.avatar),
    presence: Object.hasOwn(PRESENCES, value.presence)
      ? value.presence
      : "online",
    statusText: String(value.statusText || "").slice(0, 100),
    bio: String(value.bio || "").slice(0, 600),
    frame: Object.hasOwn(FRAMES, value.frame) ? value.frame : "none",
    profileColor: /^#[a-f\d]{6}$/i.test(value.profileColor)
      ? value.profileColor
      : "#8773ab",
  };
}
export async function prepareBanner(file) {
  if (
    !/^image\/(png|jpeg|webp|gif|avif)$/.test(file.type) ||
    file.size > 12 * 1024 * 1024
  )
    throw new Error("Выбери изображение до 12 МБ");
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 240;
    const scale = Math.max(640 / bitmap.width, 240 / bitmap.height),
      ctx = canvas.getContext("2d");
    ctx.drawImage(
      bitmap,
      (640 - bitmap.width * scale) / 2,
      (240 - bitmap.height * scale) / 2,
      bitmap.width * scale,
      bitmap.height * scale,
    );
    for (const quality of [0.8, 0.6, 0.4, 0.25]) {
      const url = canvas.toDataURL("image/webp", quality);
      if (safeBanner(url)) return url;
    }
    throw new Error("Для баннера выбери менее детальное изображение");
  } finally {
    bitmap.close();
  }
}
