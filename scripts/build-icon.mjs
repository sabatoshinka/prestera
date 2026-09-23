import { spawn } from "node:child_process";
import electron from "electron";
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ["scripts/render-icon.cjs"], { env, stdio: "inherit", windowsHide: true });
child.on("error", e => { console.error(e); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
