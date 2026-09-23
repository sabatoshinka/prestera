import { build } from "esbuild";
import { mkdir, copyFile, cp } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/main.jsx"],
  bundle: true,
  outdir: "dist",
  minify: true,
  sourcemap: true,
  loader: { ".svg": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
});
await copyFile("src/index.html", "dist/index.html");
await cp("public", "dist", { recursive: true });
console.log("Prestera: интерфейс собран.");
