const { contextBridge, ipcRenderer } = require("electron");

console.log("✅ Preload loaded");

contextBridge.exposeInMainWorld("electronAPI", {
  // --- TikTok events from main -> React
  onTiktokEvent: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("tiktok-event", listener);
    return listener; // return so React can remove later
  },
  removeTiktokEvent: (listener) => {
    ipcRenderer.removeListener("tiktok-event", listener);
  },

  onTiktokStatus: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("tiktok-status", listener);
    return listener;
  },
  removeTiktokStatus: (listener) => {
    ipcRenderer.removeListener("tiktok-status", listener);
  },

  // --- Controls React -> main
  playSound: (file) => ipcRenderer.send("play-sound", file),
  speak: (text) => ipcRenderer.send("speak-text", text),
  setVoice: (voice) => ipcRenderer.send("set-voice", voice),
  setMute: (value) => ipcRenderer.send("set-mute", value),

  // --- Connect to TikTok with username
  connectTiktok: (username) => ipcRenderer.send("connect-tiktok", username),

  // --- Disconnect from TikTok
  disconnectTiktok: () => ipcRenderer.send("disconnect-tiktok"),

  // --- File picker for sounds
  pickFile: () => ipcRenderer.invoke("dialog:openFile"),
});
