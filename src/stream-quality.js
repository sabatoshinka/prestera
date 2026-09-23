// Zero means use the quality preset. Store Mbps, pass bits/s to WebRTC.
export function streamBitrate(mbps, fallback = 10_000_000) {
  const value = Number(mbps);
  return Number.isFinite(value) && value > 0
    ? Math.round(Math.min(50, Math.max(1, value)) * 1_000_000)
    : fallback;
}
