import {
  cp,
  mkdir,
  readFile,
  writeFile,
  rename,
  access,
} from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const root = process.cwd();
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const output = path.join(root, "release", `Prestera-${pkg.version}-win-x64`);
await access("native/bin/pibble-audio.exe");
await mkdir(output, { recursive: true });
await cp("node_modules/electron/dist", output, {
  recursive: true,
  filter: (source) => {
    if (source.endsWith(".pdb") || path.basename(source) === "default_app.asar")
      return false;
    if (path.basename(path.dirname(source)) === "locales")
      return ["ru.pak", "en-US.pak"].includes(path.basename(source));
    return true;
  },
});
await rename(
  path.join(output, "electron.exe"),
  path.join(output, "Prestera.exe"),
);
await promisify(execFile)(
  "powershell.exe",
  [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    "scripts/embed-icon.ps1",
    "-Executable",
    path.join(output, "Prestera.exe"),
    "-Icon",
    path.join(root, "public", "pibble.ico"),
  ],
  { windowsHide: true },
);
const app = path.join(output, "resources", "app");
await mkdir(app, { recursive: true });
for (const folder of ["desktop", "dist"])
  await cp(folder, path.join(app, folder), { recursive: true });
await mkdir(path.join(app, "native", "bin"), { recursive: true });
await cp(
  "native/bin/pibble-audio.exe",
  path.join(app, "native", "bin", "pibble-audio.exe"),
);
await cp(
  "native/bin/prestera-gpu-video.exe",
  path.join(app, "native", "bin", "prestera-gpu-video.exe"),
);
await cp("node_modules/ws", path.join(app, "node_modules", "ws"), {
  recursive: true,
});
await writeFile(
  path.join(app, "package.json"),
  JSON.stringify(
    {
      name: pkg.name,
      productName: "Prestera",
      version: pkg.version,
      main: pkg.main,
      description: pkg.description,
    },
    null,
    2,
  ),
);
await cp("PRESTERA.txt", path.join(output, "ПРОЧТИ МЕНЯ.txt"));
await cp("server/DEPLOY.md", path.join(output, "VPS.md"));
await mkdir(path.join(output, "licenses"), { recursive: true });
for (const name of ["react", "react-dom", "lucide-react", "ws"])
  await cp(
    path.join("node_modules", name, "LICENSE"),
    path.join(output, "licenses", name + ".txt"),
  );
console.log("Готово: " + path.join(output, "Prestera.exe"));
