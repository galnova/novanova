import { app, BrowserWindow, ipcMain } from "electron";
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

  // Disconnect existing
  if (tiktok) {
    try {
      tiktok.disconnect();
    } catch (err) {
      console.error("Error disconnecting previous connection:", err);
    }
    tiktok = null;
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
  });

  tiktok.on("chat", (data) => {
    const name = data.nickname || data.uniqueId;
    const msg = `${name}: ${data.comment}`;
    win.webContents.send("tiktok-event", { msg, type: "chat" });
    enqueueSpeech(`${name} says ${data.comment}`);
  });

  tiktok.on("like", (data) => {
    const msg = `${data.uniqueId} liked (${data.likeCount} likes)`;
    win.webContents.send("tiktok-event", { msg, type: "like" });
    enqueueSpeech(`SOUND::sounds/like.mp3`);
  });

  tiktok.on("follow", (data) => {
    const msg = `${data.uniqueId} followed!`;
    win.webContents.send("tiktok-event", { msg, type: "follow" });
    enqueueSpeech(`SOUND::sounds/follow.mp3`);
  });

  tiktok.on("gift", (data) => {
    let msg = `${data.uniqueId} sent ${data.giftName}`;
    let soundFile = "sounds/small-gift.mp3";

    if (data.repeatEnd) {
      msg = `${data.uniqueId} sent a COMBO of ${data.giftName} x${data.repeatCount}`;
      soundFile = "sounds/multi-gift.mp3";
    } else if (data.diamondCount >= 100) {
      msg = `${data.uniqueId} sent a BIG gift: ${data.giftName}`;
      soundFile = "sounds/big-gift.mp3";
    }

    win.webContents.send("tiktok-event", { msg, type: "gift" });
    enqueueSpeech(`SOUND::${soundFile}`);
  });

  tiktok.on("share", (data) => {
    const msg = `${data.uniqueId} shared the stream!`;
    win.webContents.send("tiktok-event", { msg, type: "share" });
    enqueueSpeech(`SOUND::sounds/share.mp3`);
  });

  tiktok.connect().catch((err) => {
    console.error("❌ Failed:", err);
    const msg = `❌ Failed to connect: ${err.message || err}`;
    win.webContents.send("tiktok-event", { msg, type: "error" });
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
