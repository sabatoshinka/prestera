class PibblePCM extends AudioWorkletProcessor {
  constructor() {
    super();
    this.left = new Float32Array(48000);
    this.right = new Float32Array(48000);
    this.write = 0;
    this.read = 0;
    this.count = 0;
    this.port.onmessage = ({ data }) => {
      const view = new DataView(data);
      for (let offset = 0; offset + 3 < view.byteLength; offset += 4) {
        this.left[this.write] = view.getInt16(offset, true) / 32768;
        this.right[this.write] = view.getInt16(offset + 2, true) / 32768;
        this.write = (this.write + 1) % 48000;
        this.count++;
        if (this.count > 9600) {
          this.read = (this.read + 1) % 48000;
          this.count--;
        }
      }
    };
  }
  process(inputs, outputs) {
    const [l, r] = outputs[0];
    for (let i = 0; i < l.length; i++) {
      if (this.count > 0) {
        l[i] = this.left[this.read];
        if (r) r[i] = this.right[this.read];
        this.read = (this.read + 1) % 48000;
        this.count--;
      } else {
        l[i] = 0;
        if (r) r[i] = 0;
      }
    }
    return true;
  }
}
registerProcessor("pibble-pcm", PibblePCM);
