const { contextBridge, ipcRenderer } = require("electron");

console.log("✅ Preload loaded");

contextBridge.exposeInMainWorld("electronAPI", {
  onTiktokEvent: (callback) =>
    ipcRenderer.on("tiktok-event", (event, data) => {
      console.log("📡 Forwarding event to React:", data); // debug
      callback(data);
    }),
  onTiktokStatus: (callback) =>
    ipcRenderer.on("tiktok-status", (event, data) => callback(data)),
  playSound: (file) => ipcRenderer.send("play-sound", file),
  speak: (text) => ipcRenderer.send("speak-text", text),

  setVoice: (voice) => ipcRenderer.send("set-voice", voice),

  // 🔇 NEW: add mute toggle
  setMute: (value) => ipcRenderer.send("set-mute", value),
});
