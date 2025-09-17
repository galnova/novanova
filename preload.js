const { contextBridge, ipcRenderer } = require("electron");

console.log("✅ Preload loaded");

contextBridge.exposeInMainWorld("electronAPI", {
  // --- TikTok events from main -> React
  onTiktokEvent: (callback) =>
    ipcRenderer.on("tiktok-event", (_event, data) => {
      console.log("📡 Forwarding event to React:", data); // debug
      callback(data);
    }),

  onTiktokStatus: (callback) =>
    ipcRenderer.on("tiktok-status", (_event, data) => callback(data)),

  // --- Controls React -> main
  playSound: (file) => ipcRenderer.send("play-sound", file),
  speak: (text) => ipcRenderer.send("speak-text", text),
  setVoice: (voice) => ipcRenderer.send("set-voice", voice),
  setMute: (value) => ipcRenderer.send("set-mute", value),

  // --- NEW: Connect to TikTok with username
  connectTiktok: (username) => ipcRenderer.send("connect-tiktok", username),
});
