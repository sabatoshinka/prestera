// Rates use consecutive samples; cumulative counters are never shown as rates.
export function videoStats(reports, previous = new Map()) {
  const result = {};
  for (const report of reports.values()) {
    if (
      !["outbound-rtp", "inbound-rtp"].includes(report.type) ||
      report.kind !== "video"
    )
      continue;
    const old = previous.get(report.id);
    previous.set(report.id, report);
    const seconds = old ? (report.timestamp - old.timestamp) / 1000 : 0;
    const delta = (key) =>
      seconds > 0 && Number.isFinite(report[key]) && Number.isFinite(old?.[key])
        ? Math.max(0, report[key] - old[key])
        : undefined;
    const sent = report.type === "outbound-rtp";
    const bytes = delta(sent ? "bytesSent" : "bytesReceived");
    const frames = delta(sent ? "framesEncoded" : "framesDecoded");
    const count = delta("jitterBufferEmittedCount");
    const delay = delta("jitterBufferDelay");
    const encode = delta("totalEncodeTime");
    const input = reports.get(report.mediaSourceId);
    const remote = reports.get(report.remoteId);
    Object.assign(result, {
      width: report.frameWidth,
      height: report.frameHeight,
      fps:
        report.framesPerSecond ??
        (frames !== undefined ? Math.round(frames / seconds) : undefined),
      kbps:
        bytes === undefined
          ? undefined
          : Math.round((bytes * 8) / seconds / 1000),
      dropped: delta("framesDropped"),
      lost: delta("packetsLost"),
      jitterMs: Number.isFinite(report.jitter)
        ? Math.round(report.jitter * 1000)
        : undefined,
      bufferMs:
        count > 0 && delay !== undefined
          ? Math.round((delay / count) * 1000)
          : undefined,
      encodeMs:
        frames > 0 && encode !== undefined
          ? Math.round((encode / frames) * 1000)
          : undefined,
      limitation: report.qualityLimitationReason,
      encoder: report.encoderImplementation,
      inputWidth: input?.width,
      inputHeight: input?.height,
      inputFps: input?.framesPerSecond,
      remoteLoss: remote?.fractionLost,
      codec: reports.get(report.codecId)?.mimeType,
    });
  }
  return result;
}
