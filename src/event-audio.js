export class EventAudio {
  constructor() {
    this.playing = new Set();
    this.lastMessage = -Infinity;
  }
  async play(name, settings) {
    if (!settings.eventSounds || !(settings.eventGain > 0)) return;
    if (name === "message") {
      if (settings.messageSounds === false) return;
      const now = performance.now();
      if (now - this.lastMessage < 700) return;
      this.lastMessage = now;
    }
    if (this.playing.size >= 4) {
      const old = this.playing.values().next().value;
      old.pause();
      this.playing.delete(old);
    }
    const audio = new Audio(`events/${name}.wav`);
    audio.volume = Math.min(1, settings.eventGain / 100);
    this.playing.add(audio);
    audio.onended = audio.onerror = () => this.playing.delete(audio);
    try {
      await audio.setSinkId?.(settings.output || "");
      await audio.play();
    } catch {
      this.playing.delete(audio);
    }
  }
  dispose() {
    for (const audio of this.playing) audio.pause();
    this.playing.clear();
  }
}
