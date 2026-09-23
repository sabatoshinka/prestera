const bridge = window.pibble;
export async function captureWindow(choice, quality) {
  if (typeof MediaStreamTrackGenerator !== "function")
    throw new Error("GPU-видеотрек недоступен");
  const track = new MediaStreamTrackGenerator({ kind: "video" });
  const writer = track.writable.getWriter(),
    token = crypto.randomUUID();
  let active = true,
    busy = false,
    resolveFirst,
    rejectFirst;
  const first = new Promise((resolve, reject) => {
    resolveFirst = resolve;
    rejectFirst = reject;
  });
  const unsubscribe = bridge.onGpuFrame(async (imported, received) => {
    if (received !== token || !active || busy) return;
    busy = true;
    let frame;
    try {
      frame = imported.getVideoFrame();
      await writer.write(frame);
      resolveFirst();
    } catch (error) {
      rejectFirst(error);
      if (active) track.dispatchEvent(new Event("ended"));
    } finally {
      frame?.close();
      busy = false;
    }
  });
  const timer = setTimeout(
    () => rejectFirst(new Error("Не удалось принять GPU-кадр")),
    30000,
  );
  const stop = async () => {
    if (!active) return;
    active = false;
    clearTimeout(timer);
    unsubscribe();
    track.stop();
    writer.abort().catch(() => {});
    await bridge.stopWindowVideo();
  };
  try {
    const [info] = await Promise.all([
      bridge.startWindowVideo({
        id: choice.id,
        width: quality.width,
        height: quality.height,
        fps: quality.fps,
        token,
        backend: choice.backend,
      }),
      first,
    ]);
    clearTimeout(timer);
    return { stream: new MediaStream([track]), stop, info };
  } catch (error) {
    await stop();
    throw error;
  }
}
