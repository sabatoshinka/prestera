// A brief Wi-Fi loss must not pin a sender to an old adaptation level.
// Only probe upward after sustained spare bandwidth; never fight congestion.
export class ScreenRecovery {
  constructor() {
    this.goodSince = null;
    this.lastAttempt = -Infinity;
    this.count = 0;
  }
  shouldRecover({ outbound, network, source, bitrate, presetBitrate, now }) {
    const inputWidth = outbound.inputWidth || source?.width;
    const inputHeight = outbound.inputHeight || source?.height;
    const scaled =
      inputWidth > 0 &&
      inputHeight > 0 &&
      outbound.width > 0 &&
      outbound.height > 0 &&
      outbound.width * outbound.height < inputWidth * inputHeight * 0.75;
    // A static page / slow capturer is not a stalled encoder.
    const slow =
      outbound.inputFps >= 20 &&
      outbound.fps > 0 &&
      outbound.fps < outbound.inputFps * 0.65;
    // A user-selected ceiling (e.g. 50 Mbps) is not the bandwidth required to
    // recover a 1080p stream. Still require spare capacity above the current
    // traffic and the original quality preset before trying an upward probe.
    const recoveryTarget = Math.min(
      bitrate,
      Math.max(presetBitrate || bitrate, outbound.kbps * 1250),
    );
    const healthy =
      outbound.limitation === "none" &&
      outbound.kbps > 0 &&
      network.availableOutgoingBitrate >= recoveryTarget * 1.2 &&
      Number.isFinite(network.rtt) &&
      network.rtt < 200 &&
      Number.isFinite(outbound.remoteLoss) &&
      outbound.remoteLoss <= 0.02;
    if ((!scaled && !slow) || !healthy) {
      this.goodSince = null;
      return false;
    }
    this.goodSince ??= now;
    if (now - this.goodSince < 10000 || now - this.lastAttempt < 45000)
      return false;
    this.lastAttempt = now;
    this.goodSince = null;
    return true;
  }
}

export function screenParameters(parameters, quality) {
  parameters.degradationPreference = "maintain-resolution";
  for (const encoding of parameters.encodings || []) {
    encoding.maxBitrate = quality?.bitrate || 10_000_000;
    encoding.maxFramerate = quality?.fps || 60;
    encoding.scaleResolutionDownBy = 1;
  }
  return parameters;
}

const senderUpdates = new WeakMap();
export function updateSender(sender, operation) {
  const pending = (senderUpdates.get(sender) || Promise.resolve())
    .catch(() => {})
    .then(operation);
  senderUpdates.set(sender, pending);
  return pending;
}

// WebRTC's VideoStreamAdapter clears accumulated source restrictions when
// entering/leaving balanced mode. Keep the same track, bitrate and connection.
export function refreshScreenSender(sender, quality, current = () => true) {
  return updateSender(sender, async () => {
    if (!current() || !sender.getParameters().encodings?.length) return false;
    const probe = screenParameters(sender.getParameters(), quality);
    probe.degradationPreference = "balanced";
    try {
      await sender.setParameters(probe);
    } finally {
      if (current())
        await sender.setParameters(
          screenParameters(sender.getParameters(), quality),
        );
    }
    return current();
  });
}
