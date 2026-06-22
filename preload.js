const { contextBridge, ipcRenderer } = require("electron");

console.log("✅ Preload loaded");

contextBridge.exposeInMainWorld("electronAPI", {
  // --- TikTok events from main -> React
  onTiktokEvent: (callback) => {
    ipcRenderer.removeAllListeners("tiktok-event");
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("tiktok-event", listener);
    return listener;
  },
  removeTiktokEvent: (listener) => {
    ipcRenderer.removeListener("tiktok-event", listener);
  },

  onTiktokStatus: (callback) => {
    ipcRenderer.removeAllListeners("tiktok-status");
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("tiktok-status", listener);
    return listener;
  },
  removeTiktokStatus: (listener) => {
    ipcRenderer.removeListener("tiktok-status", listener);
  },

  // --- Controls React -> main
  readSound: (filePath) => ipcRenderer.invoke("read-sound", filePath),
  speak: (text) => ipcRenderer.send("speak-text", text),
  setVoice: (voice) => ipcRenderer.send("set-voice", voice),
  setMute: (value) => ipcRenderer.send("set-mute", value),

  // --- Connect / disconnect TikTok
  connectTiktok: (username) => ipcRenderer.send("connect-tiktok", username),
  disconnectTiktok: () => ipcRenderer.send("disconnect-tiktok"),

  // --- File picker for sounds
  pickFile: () => ipcRenderer.invoke("dialog:openFile"),
});
