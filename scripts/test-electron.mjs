import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import electron from "electron";

// Exercise the actual desktop crypto library (BoringSSL), not just Node/OpenSSL.
const files = readdirSync("tests").filter((name) => name.endsWith(".test.cjs"));
const child = spawn(
  electron,
  ["--test", "--test-isolation=none", ...files.map((name) => "tests/" + name)],
  {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: "inherit",
    windowsHide: true,
  },
);
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
