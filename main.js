import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();
process.env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = "true";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let TTS_VOICE = "Microsoft Zira Desktop";
let speechQueue = [];
let isSpeaking = false;
let isMuted = false;

let tiktokConnection = null;

function safePsString(str = "") {
  return String(str)
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/'/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function speak(text) {
  return new Promise((resolve) => {
    const safe = safePsString(text);
    if (!safe) { resolve(); return; }
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

async function processQueue() {
  if (isSpeaking || speechQueue.length === 0) return;
  isSpeaking = true;
  try {
    const item = speechQueue.shift();
    if (item) await speak(item);
  } catch (err) {
    console.error("processQueue error:", err);
  } finally {
    isSpeaking = false;
    processQueue();
  }
}

function enqueueSpeech(text) {
  if (isMuted) return;
  if (speechQueue.length >= 8) speechQueue.splice(0, speechQueue.length - 7);
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

    const seenMsgIds = new Set();
    function seen(data) {
      const id = String(data.msgId || "");
      if (!id) return false;
      if (seenMsgIds.has(id)) return true;
      seenMsgIds.add(id);
      if (seenMsgIds.size > 3000) seenMsgIds.delete(seenMsgIds.values().next().value);
      return false;
    }

    connection.on("chat", (data) => {
      if (seen(data)) return;
      const user = data.nickname || data.uniqueId || "viewer";
      const msg = data.content || data.comment || data.text || "";
      if (!msg) return;
      win.webContents.send("tiktok-event", {
        type: "chat",
        user,
        message: `${user}: ${msg}`,
      });
      const ttsName = safePsString(user) || data.uniqueId || "someone";
      const ttsMsg = safePsString(msg);
      if (ttsMsg) enqueueSpeech(`${ttsName} says ${ttsMsg}`);
    });

    connection.on("like", (data) => {
      if (seen(data)) return;
      const user = data.nickname || data.uniqueId || "viewer";
      const total = data.total || data.totalLikeCount || data.likeCount || 0;
      win.webContents.send("tiktok-event", {
        type: "like",
        user,
        message: `${user} liked`,
        likes: total,
      });
    });

    connection.on("member", (data) => {
      if (seen(data)) return;
      const user = data.nickname || data.uniqueId || "viewer";
      win.webContents.send("tiktok-event", {
        type: "member",
        user,
        message: `${user} joined!`,
      });
    });

    connection.on("social", (data) => {
      const displayType = (data.displayType || "").toLowerCase();
      const key = (data.key || "").toLowerCase();
      const isFollow = displayType.includes("follow") || key.includes("follow");
      const isShare = displayType.includes("share") || key.includes("share");

      if (isFollow) {
        if (seen(data)) return;
        const user = data.nickname || data.uniqueId || "viewer";
        const ttsName = safePsString(user) || data.uniqueId || "someone";
        win.webContents.send("tiktok-event", {
          type: "follow",
          user,
          message: `${user} followed!`,
        });
        enqueueSpeech(`Thank you ${ttsName} for the follow!`);
      } else if (isShare) {
        if (seen(data)) return;
        const user = data.nickname || data.uniqueId || "viewer";
        const ttsName = safePsString(user) || data.uniqueId || "someone";
        win.webContents.send("tiktok-event", {
          type: "share",
          user,
          message: `${user} shared!`,
        });
        enqueueSpeech(`Thank you ${ttsName} for the share!`);
      }
    });

    connection.on("gift", (data) => {
      if (seen(data)) return;
      if (!data.repeatEnd && data.repeatCount > 1) return;
      const user = data.nickname || data.uniqueId || "viewer";
      const count = data.repeatCount || 1;
      const soundKey = count >= 100 ? "bigGift" : count >= 10 ? "multiGift" : "smallGift";
      win.webContents.send("tiktok-event", {
        type: "gift",
        user,
        message: `${user} sent a gift x${count}`,
        soundKey,
      });
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
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, "dist", "index.html"));
  }
}

ipcMain.on("speak-text", (_event, text) => enqueueSpeech(text));
ipcMain.handle("read-sound", async (_event, filePath) => {
  try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);
    return await fs.promises.readFile(fullPath);
  } catch (e) {
    console.error("Sound file not found:", e.message);
    return null;
  }
});
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
