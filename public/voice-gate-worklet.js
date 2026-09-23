class PibbleVoiceGate extends AudioWorkletProcessor {
  constructor() {
    super();
    this.options = { enabled: false, threshold: -52, hold: 250 };
    this.gain = 1;
    this.remaining = 0;
    this.frames = 0;
    this.port.onmessage = ({ data }) => {
      this.options = {
        enabled: !!data.enabled,
        threshold: Math.max(-80, Math.min(-10, Number(data.threshold) || -52)),
        hold: Math.max(50, Math.min(1000, Number(data.hold) || 250)),
      };
    };
  }
  process(inputs, outputs) {
    const input = inputs[0],
      output = outputs[0];
    if (!output?.length) return true;
    const count = output[0].length;
    let sum = 0;
    for (const channel of input)
      for (const sample of channel) sum += sample * sample;
    const rms = Math.sqrt(sum / Math.max(1, count * input.length));
    const db = Math.max(-96, 20 * Math.log10(Math.max(rms, 1e-8)));
    const threshold = this.options.threshold - (this.remaining > 0 ? 4 : 0);
    if (db >= threshold)
      this.remaining = (sampleRate * this.options.hold) / 1000;
    else this.remaining = Math.max(0, this.remaining - count);
    const open = !this.options.enabled || this.remaining > 0;
    const target = open ? 1 : 0;
    const rate = 1 - Math.exp(-1 / (sampleRate * (open ? 0.005 : 0.035)));
    for (let i = 0; i < count; i++) {
      this.gain += (target - this.gain) * rate;
      for (let c = 0; c < output.length; c++)
        output[c][i] = (input[c]?.[i] ?? input[0]?.[i] ?? 0) * this.gain;
    }
    this.frames += count;
    if (this.frames >= sampleRate / 20) {
      this.frames = 0;
      this.port.postMessage({ db, open, rms });
    }
    return true;
  }
}
registerProcessor("pibble-voice-gate", PibbleVoiceGate);
