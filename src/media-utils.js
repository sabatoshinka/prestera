export const safeAvatar = (value) =>
  typeof value === "string" &&
  value.length <= 48000 &&
  /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)
    ? value
    : "";

export async function prepareImage(file, avatar = false) {
  if (
    !file ||
    file.size > 12 * 1024 * 1024 ||
    !/^image\/(png|jpeg|webp|gif|avif)$/.test(file.type)
  )
    throw new Error("Выбери изображение PNG, JPG, WebP или GIF до 12 МБ");
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1920 / bitmap.width, 1080 / bitmap.height);
    canvas.width = avatar ? 160 : Math.round(bitmap.width * scale);
    canvas.height = avatar ? 160 : Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (avatar) {
      const side = Math.min(bitmap.width, bitmap.height);
      ctx.drawImage(
        bitmap,
        (bitmap.width - side) / 2,
        (bitmap.height - side) / 2,
        side,
        side,
        0,
        0,
        160,
        160,
      );
    } else ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL("image/webp", avatar ? 0.8 : 0.78);
    if (result.length > (avatar ? 48000 : 1500000))
      throw new Error("Изображение слишком сложное. Выбери файл поменьше.");
    return result;
  } finally {
    bitmap.close();
  }
}

export function trimToWav(buffer, start, end) {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end > buffer.duration + 0.001 ||
    end - start < 0.05 ||
    end - start > 30.001
  )
    throw new Error("Выдели от 0,05 до 30 секунд внутри записи");
  const first = Math.floor(start * buffer.sampleRate);
  const last = Math.min(buffer.length, Math.floor(end * buffer.sampleRate));
  const channels = Math.min(2, buffer.numberOfChannels);
  const frames = last - first,
    size = frames * channels * 2;
  const data = new ArrayBuffer(44 + size),
    view = new DataView(data);
  const text = (offset, value) =>
    [...value].forEach((char, i) =>
      view.setUint8(offset + i, char.charCodeAt(0)),
    );
  text(0, "RIFF");
  view.setUint32(4, 36 + size, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, size, true);
  const samples = Array.from({ length: channels }, (_, i) =>
    buffer.getChannelData(i),
  );
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < channels; c++) {
      const value = Math.max(-1, Math.min(1, samples[c][first + i]));
      view.setInt16(
        44 + (i * channels + c) * 2,
        Math.round(value * (value < 0 ? 32768 : 32767)),
        true,
      );
    }
  return new Blob([data], { type: "audio/wav" });
}

export function spotifyUrl(value) {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.hostname !== "open.spotify.com" ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    const match = url.pathname.match(
      /^\/(?:intl-[a-z]{2}\/)?(track|playlist|album|artist)\/([a-zA-Z0-9]{22})\/?$/,
    );
    return match
      ? {
          url: `https://open.spotify.com/${match[1]}/${match[2]}`,
          embed: `https://open.spotify.com/embed/${match[1]}/${match[2]}?theme=0`,
        }
      : null;
  } catch {
    return null;
  }
}

export function timeLabel(seconds = 0) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
