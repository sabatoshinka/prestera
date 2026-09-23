import { mkdir, writeFile } from "node:fs/promises";
await mkdir("public/frames", { recursive: true });
const frames = {
  signal:
    '<circle cx="80" cy="80" r="66" stroke="#e3e7ee" stroke-width="3" stroke-dasharray="100 12 34 18"/><path d="M14 60h16m100 37h19M42 17h28m29 126h20" stroke="#70e7f5" stroke-width="5"/><path d="M17 85h8m109-52h10M53 145h8" stroke="#f399ce" stroke-width="3"/>',
  fracture:
    '<path d="M22 49 37 24 69 12 83 20 107 17 136 44 143 73 135 86 140 113 115 137 91 145 75 137 51 141 21 113 17 82 25 71Z" stroke="#e9e9ef" stroke-width="3"/><path d="m37 24 9 14m61-21-5 16m38 80-17-4M51 141l5-17M17 82l17-2" stroke="#b5a2f2" stroke-width="4"/>',
  orbit:
    '<circle cx="80" cy="80" r="66" stroke="#a9b3c9" stroke-width="2"/><ellipse cx="80" cy="80" rx="77" ry="56" transform="rotate(-35 80 80)" stroke="#c9b4fc" stroke-width="2"/><path d="m130 24 3 8 8 3-8 3-3 8-3-8-8-3 8-3Zm-105 79 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" fill="#f1e6ff"/><circle cx="82" cy="146" r="4" fill="#8fe4ee"/>',
  thorn:
    '<circle cx="80" cy="80" r="65" stroke="#becad0" stroke-width="3"/><path d="m35 25 5 20-21-3m97-21-5 22 21-5m12 76-22-3 6 22m-84 4 0-22-21 5M80 8l-7 16 14-3m-7 131 6-15-14 3" stroke="#e0e7ee" stroke-width="3"/><path d="m26 85-15 3m124-18 15-6" stroke="#78d4c5" stroke-width="4"/>',
  pixel:
    '<path d="M48 15h64v9h17v17h15v70h-12v19h-20v15H47v-12H27v-22H15V47h13V27h20Z" stroke="#e8e8eb" stroke-width="3"/><path d="M12 51h10v15H12zm111 76h11v12h-11zM81 9h14v7H81z" fill="#6bd5ee"/><path d="M30 126h8v8h-8zm109-88h8v8h-8z" fill="#c0a7f1"/><path d="M51 20h9m5 0h9m5 0h9M62 141h9m5 0h9" stroke="#25202d" stroke-width="4"/>',
  ghost:
    '<circle cx="80" cy="80" r="66" stroke="#eee9ff" stroke-width="2" stroke-dasharray="3 5"/><path d="M18 58a67 67 0 0 1 91-42M143 94a66 66 0 0 1-88 47" stroke="#b3a4d8" stroke-width="5"/><path d="M115 18q0-14 13-14t13 14v19l-6-4-7 4-7-4-6 4Z" fill="#eee9ff" stroke="#27212f" stroke-width="2"/><path d="M123 18h3m6 0h3" stroke="#27212f" stroke-width="3"/><path d="M18 110h13m-11 6h7m106-63h14" stroke="#a0e1e5" stroke-width="3"/>',
};
for (const [name, shapes] of Object.entries(frames))
  await writeFile(
    `public/frames/${name}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" fill="none">${shapes}</svg>`,
  );
await mkdir("public/events", { recursive: true });
const cues = {
  message: [
    [0, 880, 0.1],
    [0.07, 1174.66, 0.13],
  ],
  join: [
    [0, 523.25, 0.14],
    [0.1, 659.25, 0.18],
    [0.21, 783.99, 0.24],
  ],
  leave: [
    [0, 659.25, 0.17],
    [0.13, 440, 0.25],
  ],
  "mic-on": [
    [0, 740, 0.1],
    [0.075, 987.77, 0.13],
  ],
  "mic-off": [
    [0, 740, 0.11],
    [0.08, 493.88, 0.14],
  ],
  "deafen-on": [
    [0, 440, 0.16],
    [0.12, 293.66, 0.2],
  ],
  "deafen-off": [
    [0, 440, 0.14],
    [0.1, 659.25, 0.2],
  ],
  "camera-on": [
    [0, 587.33, 0.1],
    [0.07, 880, 0.17],
  ],
  "camera-off": [
    [0, 587.33, 0.1],
    [0.07, 392, 0.16],
  ],
  "screen-on": [
    [0, 392, 0.16],
    [0.1, 587.33, 0.16],
    [0.2, 783.99, 0.2],
  ],
  "screen-off": [
    [0, 587.33, 0.16],
    [0.12, 392, 0.22],
  ],
};
for (const [name, notes] of Object.entries(cues)) {
  const rate = 48000,
    length = Math.ceil(
      (Math.max(...notes.map(([s, f, d]) => s + d)) + 0.02) * rate,
    ),
    wav = Buffer.alloc(44 + length * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(length * 2, 40);
  for (let i = 0; i < length; i++) {
    const t = i / rate;
    let sample = 0;
    for (const [start, freq, duration] of notes) {
      const u = t - start;
      if (u < 0 || u >= duration) continue;
      const envelope = Math.min(1, u / 0.009) * Math.pow(1 - u / duration, 2);
      sample +=
        0.3 *
        envelope *
        (Math.sin(2 * Math.PI * freq * u) +
          0.12 * Math.sin(4 * Math.PI * freq * u));
    }
    wav.writeInt16LE(
      Math.round(Math.max(-0.9, Math.min(0.9, sample)) * 32767),
      44 + i * 2,
    );
  }
  await writeFile(`public/events/${name}.wav`, wav);
}
console.log(
  "Created six SIGNAL / NOISE avatar frames and eleven original event sounds.",
);
