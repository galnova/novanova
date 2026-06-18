import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import player from "play-sound";
import dotenv from "dotenv";

dotenv.config();
process.env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = "true";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let TTS_VOICE = "Microsoft Zira Desktop";
let speechQueue = [];
let isSpeaking = false;
const audioPlayer = player();
let isMuted = false;

let tiktokConnection = null;

function safePsString(str = "") {
  return String(str).replace(/'/g, "''");
}

function speak(text) {
  return new Promise((resolve) => {
    const safe = safePsString(text);
    exec(
      `powershell -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Speech; ` +
        `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
        `$s.SelectVoice('${safePsString(TTS_VOICE)}'); ` +
        `$s.Speak('${safe}');"`,
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
  try {
    const item = speechQueue.shift();
    if (item && item.startsWith("SOUND::")) {
      await playSound(item.split("::")[1]);
      await new Promise((r) => setTimeout(r, 300));
    } else if (item) {
      await speak(item);
    }
  } catch (err) {
    console.error("processQueue error:", err);
  } finally {
    isSpeaking = false;
    processQueue();
  }
}

function enqueueSpeech(text) {
  if (isMuted) return;
  if (speechQueue.length > 200) speechQueue.shift();
  speechQueue.push(text);
  processQueue();
}

async function connectTiktok(win, username) {
  disconnectTiktok(win, false);
  speechQueue = [];
  isSpeaking = false;

  try {
    const { WebcastPushConnection } = await import("tiktok-live-connector/legacy");

    const cookieStr = (process.env.TIKTOK_COOKIES || "").replace(/^"|"$/g, "");
    let sessionId = "";
    let ttTargetIdc = "";
    for (const pair of cookieStr.split(";")) {
      const eqIdx = pair.indexOf("=");
      if (eqIdx < 0) continue;
      const name = pair.slice(0, eqIdx).trim();
      const value = pair.slice(eqIdx + 1).trim();
      if (name === "sessionid") sessionId = value;
      if (name === "tt-target-idc") ttTargetIdc = value;
    }

    const connection = new WebcastPushConnection(username, {
      authenticateWs: true,
      signApiKey: process.env.EULER_API_KEY || undefined,
      session: {
        cookie: {
          type: "cookie",
          value: { sessionId, ttTargetIdc },
        },
      },
    });

    tiktokConnection = connection;

    connection.on("chat", (data) => {
      const user = data.nickname || data.uniqueId || "viewer";
      const msg = data.comment || data.content || "";
      if (!msg) return;
      win.webContents.send("tiktok-event", {
        type: "chat",
        user,
        message: `${user}: ${msg}`,
      });
      enqueueSpeech(`${user} says ${msg}`);
    });

    connection.on("like", (data) => {
      const user = data.nickname || data.uniqueId || "viewer";
      const total = data.total || data.totalLikeCount || data.likeCount || 0;
      win.webContents.send("tiktok-event", {
        type: "like",
        user,
        message: `${user} liked ❤️`,
        likes: total,
      });
    });

    connection.on("member", (data) => {
      const user = data.nickname || data.uniqueId || "viewer";
      win.webContents.send("tiktok-event", {
        type: "follow",
        user,
        message: `${user} joined! ✅`,
      });
      enqueueSpeech("SOUND::sounds/follow.mp3");
    });

    connection.on("follow", (data) => {
      const user = data.nickname || data.uniqueId || "viewer";
      win.webContents.send("tiktok-event", {
        type: "follow",
        user,
        message: `${user} followed! ✅`,
      });
      enqueueSpeech("SOUND::sounds/follow.mp3");
    });

    connection.on("share", (data) => {
      const user = data.nickname || data.uniqueId || "viewer";
      win.webContents.send("tiktok-event", {
        type: "share",
        user,
        message: `${user} shared! 🔄`,
      });
      enqueueSpeech("SOUND::sounds/share.mp3");
    });

    connection.on("gift", (data) => {
      if (!data.repeatEnd && data.repeatCount > 1) return;
      const user = data.nickname || data.uniqueId || "viewer";
      const count = data.repeatCount || 1;
      let soundFile;
      if (count >= 100) soundFile = "sounds/big-gift.mp3";
      else if (count >= 10) soundFile = "sounds/multi-gift.mp3";
      else soundFile = "sounds/small-gift.mp3";
      win.webContents.send("tiktok-event", {
        type: "gift",
        user,
        message: `${user} sent a gift x${count} 🎁`,
      });
      enqueueSpeech(`SOUND::${soundFile}`);
    });

    connection.on("disconnected", () => {
      win.webContents.send("tiktok-status", { connected: false });
    });

    connection.on("error", (err) => {
      console.error("TikTok connection error:", err);
      win.webContents.send("tiktok-event", {
        type: "error",
        message: `Connection error: ${err.message || err}`,
      });
    });

    await connection.connect();
    win.webContents.send("tiktok-status", { connected: true });
    console.log(`✅ Connected to @${username}'s live`);

  } catch (err) {
    console.error("❌ Connect error:", err);
    win.webContents.send("tiktok-event", {
      type: "error",
      message: `Failed to connect: ${err.message || err}`,
    });
    win.webContents.send("tiktok-status", { connected: false });
    tiktokConnection = null;
  }
}

function disconnectTiktok(win, notify = true) {
  if (tiktokConnection) {
    try { tiktokConnection.disconnect(); } catch (e) {}
    tiktokConnection = null;
  }
  speechQueue = [];
  isSpeaking = false;
  if (notify && win) {
    win.webContents.send("tiktok-status", { connected: false });
  }
}

function createWindow() {
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
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(__dirname, "dist", "index.html"));
  }
}

ipcMain.on("play-sound", (_event, file) => enqueueSpeech(`SOUND::${file}`));
ipcMain.on("speak-text", (_event, text) => enqueueSpeech(text));
ipcMain.on("set-voice", (_event, voice) => {
  if (voice === "Zira") TTS_VOICE = "Microsoft Zira Desktop";
  if (voice === "David") TTS_VOICE = "Microsoft David Desktop";
});
ipcMain.on("set-mute", (_event, value) => {
  isMuted = !!value;
});

ipcMain.on("connect-tiktok", (_event, username) => {
  const win = BrowserWindow.getFocusedWindow();
  if (win && username) {
    console.log(`🔗 Connecting to @${username}...`);
    connectTiktok(win, username);
  } else if (win) {
    win.webContents.send("tiktok-event", {
      type: "error",
      message: "Please enter a TikTok username.",
    });
  }
});

ipcMain.on("disconnect-tiktok", (_event) => {
  const win = BrowserWindow.getFocusedWindow();
  disconnectTiktok(win, true);
});

ipcMain.handle("dialog:openFile", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Audio Files", extensions: ["mp3", "wav"] }],
  });
  if (canceled) return null;
  return filePaths[0];
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
