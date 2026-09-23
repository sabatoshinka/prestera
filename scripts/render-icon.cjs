const { app, BrowserWindow, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const profile = path.join(root, ".cache", "icon-renderer");
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 256, height: 256, useContentSize: true, frame: false, show: false, transparent: true, webPreferences: { offscreen: true, sandbox: true } });
  const svg = fs.readFileSync(path.join(root, "public", "pibble.svg"), "utf8");
  await win.loadURL("about:blank");
  const data = await win.webContents.executeJavaScript(`(async () => {
    const image = new Image(); image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(${JSON.stringify(svg)});
    await image.decode(); const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    canvas.getContext('2d').drawImage(image, 0, 0, 256, 256); return canvas.toDataURL('image/png');
  })()`);
  const png = nativeImage.createFromDataURL(data);
  if (png.isEmpty()) throw new Error("Empty icon render");
  fs.writeFileSync(path.join(root, "public", "pibble.png"), png.toPNG());
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = sizes.map(size => png.resize({ width: size, height: size, quality: "best" }).toPNG());
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const entry = 6 + i * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[i].length, entry + 8); header.writeUInt32LE(offset, entry + 12);
    offset += images[i].length;
  });
  fs.writeFileSync(path.join(root, "public", "pibble.ico"), Buffer.concat([header, ...images]));
  console.log("Pibble vector icon rendered as PNG and multi-size ICO.");
  win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
