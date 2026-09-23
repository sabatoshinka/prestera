const { spawn } = require("node:child_process");
const { sharedTexture } = require("electron");
class GpuVideo {
  constructor(executable, contents, ended) {
    this.executable = executable;
    this.contents = contents;
    this.ended = ended;
  }
  stop() {
    const proc = this.proc;
    this.proc = null;
    if (!proc) return;
    proc.stdin.write("stop\n", () => {});
    const timer = setTimeout(() => proc.kill(), 4000);
    timer.unref();
    proc.once("exit", () => clearTimeout(timer));
  }
  start(choice, border) {
    this.stop();
    return new Promise((resolve, reject) => {
      const proc = spawn(
        this.executable,
        [
          choice.id.split(":")[1],
          String(choice.width),
          String(choice.height),
          String(choice.fps),
          String(process.pid),
          border ? "1" : "0",
          choice.backend,
        ],
        { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      );
      this.proc = proc;
      let buffer = "",
        ready = false,
        failed = false,
        meta = {},
        detail = "";
      const command = (op, seq) => {
        if (!proc.stdin.destroyed) proc.stdin.write(`${op} ${seq}\n`, () => {});
      };
      const fail = (error) => {
        if (failed) return;
        failed = true;
        clearTimeout(timer);
        if (this.proc === proc) {
          this.stop();
          if (ready)
            this.ended("GPU-захват завершился. Запусти демонстрацию снова.");
        }
        if (!ready)
          reject(
            new Error(
              error?.message ||
                `GPU-захват недоступен${detail ? ` (${detail.trim()})` : ""}`,
            ),
          );
      };
      const timer = setTimeout(
        () => fail(new Error("Окно не передало GPU-кадр")),
        30000,
      );
      proc.stdin.on("error", () => {});
      proc.stderr.on("data", (data) => {
        detail = (detail + data.toString()).slice(-500);
      });
      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (data) => {
        buffer += data;
        if (buffer.length > 16384)
          return fail(new Error("Некорректный ответ захвата"));
        let at;
        while ((at = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, at);
          buffer = buffer.slice(at + 1);
          let message;
          try {
            message = JSON.parse(line);
          } catch {
            fail();
            return;
          }
          if (message.type === "ready") {
            meta = {
              backend:
                message.backend === "GDI"
                  ? "Окно · CPU → GPU"
                  : message.backend === "DWM"
                    ? "DWM · GPU"
                    : "WGC · GPU",
              borderless: !!message.borderless,
            };
            continue;
          }
          if (
            message.type !== "frame" ||
            !Number.isSafeInteger(message.seq) ||
            !/^\d+$/.test(message.handle) ||
            !Number.isInteger(message.width) ||
            !Number.isInteger(message.height) ||
            message.width < 2 ||
            message.width > 1920 ||
            message.height < 2 ||
            message.height > 1080 ||
            !Number.isSafeInteger(message.timestamp)
          ) {
            fail();
            return;
          }
          if (this.proc !== proc || failed) {
            command("r", message.seq);
            continue;
          }
          let imported;
          try {
            const handle = Buffer.alloc(8);
            handle.writeBigUInt64LE(BigInt(message.handle));
            imported = sharedTexture.importSharedTexture({
              textureInfo: {
                handle: { ntHandle: handle },
                pixelFormat: "bgra",
                codedSize: { width: message.width, height: message.height },
                timestamp: message.timestamp,
              },
              allReferencesReleased: () => command("r", message.seq),
            });
            command("i", message.seq);
            sharedTexture
              .sendSharedTexture(
                {
                  frame: this.contents().mainFrame,
                  importedSharedTexture: imported,
                },
                choice.token,
              )
              .then(() => {
                if (!ready && this.proc === proc && !failed) {
                  ready = true;
                  clearTimeout(timer);
                  resolve({
                    ...meta,
                    width: message.width,
                    height: message.height,
                  });
                }
              })
              .catch(fail)
              .finally(() => imported.release());
          } catch (error) {
            if (imported) imported.release();
            else command("r", message.seq);
            fail(error);
          }
        }
      });
      proc.on("error", fail);
      proc.on("exit", () => fail());
    });
  }
}
module.exports = { GpuVideo };
