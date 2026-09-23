const { contextBridge, ipcRenderer, sharedTexture } = require("electron");
let gpuReceiver;
if (sharedTexture)
  sharedTexture.setSharedTextureReceiver(
    async ({ importedSharedTexture }, token) => {
      try {
        await gpuReceiver?.(
          { getVideoFrame: importedSharedTexture.getVideoFrame },
          token,
        );
      } finally {
        importedSharedTexture.release();
      }
    },
  );
const listen = (channel, callback) => {
  const handler = (_, value) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};
contextBridge.exposeInMainWorld("pibble", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateState: () => ipcRenderer.invoke("updates:state"),
  checkUpdates: () => ipcRenderer.invoke("updates:check"),
  downloadUpdate: () => ipcRenderer.invoke("updates:download"),
  cancelUpdate: () => ipcRenderer.invoke("updates:cancel"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),
  onUpdate: (callback) => listen("updates:state", callback),
  openDataFolder: () => ipcRenderer.invoke("data:open"),
  musicLibrary: () => ipcRenderer.invoke("music:library"),
  updatePlaylist: (value) => ipcRenderer.invoke("music:update", value),
  addPlaylistFiles: (id) => ipcRenderer.invoke("music:add", id),
  readMusicTrack: (id) => ipcRenderer.invoke("music:read", id),
  saveSettings: (value) => ipcRenderer.invoke("settings:set", value),
  host: (value) => ipcRenderer.invoke("room:host", value),
  join: (value) => ipcRenderer.invoke("room:join", value),
  leave: () => ipcRenderer.invoke("room:leave"),
  signal: (value) => ipcRenderer.invoke("room:signal", value),
  onRoom: (callback) => listen("room-event", callback),
  onHotkey: (callback) => listen("hotkey", callback),
  onInvite: (callback) => listen("invite", callback),
  copy: (value) => ipcRenderer.invoke("clipboard:write", value),
  sources: () => ipcRenderer.invoke("capture:sources"),
  selectSource: (value) => ipcRenderer.invoke("capture:select", value),
  startAppAudio: (id) => ipcRenderer.invoke("audio:start", id),
  stopAppAudio: () => ipcRenderer.invoke("audio:stop"),
  startWindowVideo: (value) => ipcRenderer.invoke("video:start", value),
  onGpuFrame: (callback) => {
    gpuReceiver = callback;
    return () => {
      if (gpuReceiver === callback) gpuReceiver = null;
    };
  },
  stopWindowVideo: () => ipcRenderer.invoke("video:stop"),
  onWindowVideoEnded: (callback) => listen("window-video-ended", callback),
  onAppAudio: (callback) => listen("app-audio", callback),
  onAudioEnded: (callback) => listen("audio-ended", callback),
  saveFile: (value) => ipcRenderer.invoke("file:save", value),
  minimize: () => ipcRenderer.invoke("window:action", "minimize"),
  registerLinks: () => ipcRenderer.invoke("protocol:register"),
  openSpotify: (url) => ipcRenderer.invoke("spotify:open", url),
});
