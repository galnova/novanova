import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import { WebcastPushConnection } from "tiktok-live-connector";
import { exec } from "child_process";
import player from "play-sound";
import dotenv from "dotenv";

dotenv.config();
process.env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = "true";

// ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Config ---
let TTS_VOICE = "Microsoft Zira Desktop"; // 👩 Default
let speechQueue = [];
let isSpeaking = false;
const audioPlayer = player();
let isMuted = false; // 🔇 mute flag
let tiktok = null;   // store current connection
let totalLikes = 0;  // ✅ track likes properly

function speak(text) {
  return new Promise((resolve) => {
    exec(
      `powershell -Command "Add-Type -AssemblyName System.Speech; ` +
        `$speak = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
        `$speak.SelectVoice('${TTS_VOICE}'); ` +
        `$speak.Speak('${text}');"`,
      (err) => {
        if (err) console.error("TTS Error:", err);
        resolve();
      }
    );
  });
}

function playSound(file) {
  const fullPath = path.join(__dirname, file);
  return new Promise((resolve) => {
    audioPlayer.play(fullPath, (err) => {
      if (err) console.error("Error playing sound:", err);
      resolve();
    });
  });
}

async function processQueue() {
  if (isSpeaking || speechQueue.length === 0) return;
  isSpeaking = true;

  const item = speechQueue.shift();
  if (item.startsWith("SOUND::")) {
    const file = item.split("::")[1];
    await playSound(file);
    await new Promise((r) => setTimeout(r, 1200));
  } else {
    await speak(item);
  }

  isSpeaking = false;
  processQueue();
}

function enqueueSpeech(text) {
  if (isMuted) {
    console.log("🔇 Muted — skipping:", text);
    return;
  }
  // ✅ guard against runaway queues
  if (speechQueue.length > 50) {
    speechQueue.shift();
  }
  speechQueue.push(text);
  processQueue();
}

// --- TikTok connection helper ---
function connectTiktok(win, username) {
  const cookies = process.env.TIKTOK_COOKIES;
  if (!cookies) {
    console.error("❌ No cookies found in .env (TIKTOK_COOKIES=...)");
    return;
  }

  // Disconnect existing first
  if (tiktok) {
    try {
      tiktok.removeAllListeners();
      tiktok.disconnect();
    } catch (err) {
      console.error("Error disconnecting previous connection:", err);
    }
    tiktok = null;
    speechQueue = [];
    isSpeaking = false;
    totalLikes = 0;
  }

  tiktok = new WebcastPushConnection(username, {
    requestOptions: {
      headers: { cookie: cookies },
    },
    signApiUrl: "http://localhost:8080/sign",
  });

  // --- Event Handlers ---
  tiktok.on("connected", (state) => {
    console.log("✅ Connected:", state.roomId);
    win.webContents.send("tiktok-status", { connected: true });
  });

  tiktok.on("disconnected", () => {
    console.log("⚠️ Disconnected");
    win.webContents.send("tiktok-status", { connected: false });
    speechQueue = [];
    isSpeaking = false;
  });

  tiktok.on("chat", (data) => {
    const user = data.nickname || data.uniqueId;
    const message = data.comment;
    console.log("📥 Chat event:", user, message);
    win.webContents.send("tiktok-event", {
      type: "chat",
      user,
      message,
      meta: data,
    });
    enqueueSpeech(`${user} says ${message}`);
  });

  tiktok.on("like", (data) => {
    if (data.totalLikeCount !== undefined) {
      totalLikes = data.totalLikeCount;
    } else {
      totalLikes += data.likeCount || 0;
    }
    console.log("❤️ Like event:", data.uniqueId, "Total:", totalLikes);
    win.webContents.send("tiktok-event", {
      type: "like",
      user: data.uniqueId,
      message: `${data.uniqueId} liked`,
      likes: totalLikes,
      meta: data,
    });
  });

  tiktok.on("follow", (data) => {
    const user = data.uniqueId;
    console.log("👤 Follow event:", user);
    win.webContents.send("tiktok-event", {
      type: "follow",
      user,
      message: `${user} followed!`,
      meta: data,
    });
    enqueueSpeech(`SOUND::sounds/follow.mp3`);
  });

  tiktok.on("gift", (data) => {
    const user = data.uniqueId;
    let message = `${user} sent ${data.giftName}`;
    let soundFile = "sounds/small-gift.mp3";

    if (data.repeatEnd) {
      message = `${user} sent a COMBO of ${data.giftName} x${data.repeatCount}`;
      soundFile = "sounds/multi-gift.mp3";
    } else if (data.diamondCount >= 100) {
      message = `${user} sent a BIG gift: ${data.giftName}`;
      soundFile = "sounds/big-gift.mp3";
    }

    console.log("🎁 Gift event:", message);
    win.webContents.send("tiktok-event", {
      type: "gift",
      user,
      message,
      meta: data,
    });
    enqueueSpeech(`SOUND::${soundFile}`);
  });

  tiktok.on("share", (data) => {
    const user = data.uniqueId;
    const message = `${user} shared the stream!`;
    console.log("🔗 Share event:", message);
    win.webContents.send("tiktok-event", {
      type: "share",
      user,
      message,
      meta: data,
    });
    enqueueSpeech(`SOUND::sounds/share.mp3`);
  });

  tiktok.connect().catch((err) => {
    console.error("❌ Failed:", err);
    const msg = `❌ Failed to connect: ${err.message || err}`;
    win.webContents.send("tiktok-event", { type: "error", message: msg });
    win.webContents.send("tiktok-status", { connected: false });
  });
}

// --- Window ---
function createWindow() {
  console.log("🔎 Preload path:", path.resolve(__dirname, "preload.js"));

  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
      preload: path.resolve(__dirname, "preload.js"),
    },
  });

  if (!app.isPackaged) {
    win.loadURL("http://localhost:5173"); // Vite dev server
  } else {
    win.loadFile(path.join(__dirname, "dist", "index.html"));
  }
}

// --- IPC ---
ipcMain.on("play-sound", (_event, file) => enqueueSpeech(`SOUND::${file}`));
ipcMain.on("speak-text", (_event, text) => enqueueSpeech(text));
ipcMain.on("set-voice", (_event, voice) => {
  if (voice === "Zira") TTS_VOICE = "Microsoft Zira Desktop";
  if (voice === "David") TTS_VOICE = "Microsoft David Desktop";
  console.log(`🔊 Voice changed to: ${TTS_VOICE}`);
});
ipcMain.on("set-mute", (_event, value) => {
  isMuted = value;
  console.log(isMuted ? "🔇 Muted" : "🔊 Unmuted");
});
ipcMain.on("connect-tiktok", (_event, username) => {
  const win = BrowserWindow.getFocusedWindow();
  if (win && username) {
    console.log("🔗 Connecting to TikTok username:", username);
    connectTiktok(win, username);
  }
});

// ✅ Manual disconnect from UI
ipcMain.on("disconnect-tiktok", (_event) => {
  if (tiktok) {
    try {
      tiktok.removeAllListeners();
      tiktok.disconnect();
    } catch (err) {
      console.error("Error disconnecting:", err);
    }
    tiktok = null;
    speechQueue = [];
    isSpeaking = false;
    totalLikes = 0;
  }

  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    win.webContents.send("tiktok-status", { connected: false });
  }
});

// --- File Picker for custom sounds ---
ipcMain.handle("dialog:openFile", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Audio Files", extensions: ["mp3", "wav"] }],
  });
  if (canceled) return null;
  return filePaths[0];
});

// --- App lifecycle ---
app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
