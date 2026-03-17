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
let TTS_VOICE = "Microsoft Zira Desktop";
let speechQueue = [];
let isSpeaking = false;
const audioPlayer = player();
let isMuted = false;
let tiktok = null;
let totalLikes = 0;
let recentlyConnected = false; // used to suppress transient errors

// --- Chat de-duplication (LRU of recent message IDs) ---
const SEEN_MAX = 1000;
const seenChatIds = new Set();
const seenOrder = [];
function rememberId(id) {
  if (!id) return true;
  if (seenChatIds.has(id)) return false;
  seenChatIds.add(id);
  seenOrder.push(id);
  if (seenOrder.length > SEEN_MAX) {
    const old = seenOrder.shift();
    if (old) seenChatIds.delete(old);
  }
  return true;
}
function clearSeen() {
  seenChatIds.clear();
  seenOrder.length = 0;
}

// --- Utilities ---
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
      const file = item.split("::")[1];
      await playSound(file);
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
  if (isMuted) {
    console.log("🔇 Muted — skipping:", text);
    return;
  }
  if (speechQueue.length > 200) {
    speechQueue.shift();
  }
  speechQueue.push(text);
  processQueue();
}

// --- Robust extraction helpers ---
function extractChatId(data) {
  return (
    data?.msgId ||
    data?.messageId ||
    data?.id ||
    data?.eventId ||
    `${data?.userId || data?.authorId || data?.uid || data?.uniqueId || "u"}-${data?.comment || data?.text || ""}-${data?.createTime || data?.ts || ""}`
  );
}

function extractUserFields(data) {
  const nickname =
    data?.nickname ??
    data?.user?.nickname ??
    data?.sender?.nickname ??
    data?.author?.nickname ??
    data?.profile?.nickname ??
    null;

  const uniqueId =
    data?.uniqueId ??
    data?.user?.uniqueId ??
    data?.sender?.uniqueId ??
    data?.author?.uniqueId ??
    data?.profile?.uniqueId ??
    null;

  const userId =
    data?.userId ??
    data?.authorId ??
    data?.uid ??
    data?.user?.id ??
    data?.sender?.id ??
    data?.author?.id ??
    null;

  const displayName = nickname || uniqueId || (userId ? `user_${userId}` : "unknown_user");
  return { nickname: nickname || null, uniqueId: uniqueId || null, userId: userId ?? null, displayName };
}

// --- TikTok connection helper ---
function connectTiktok(win, username, cookies) {
  const resolvedCookies = cookies || process.env.TIKTOK_COOKIES || null;

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
    clearSeen();
  }

  recentlyConnected = false;

  tiktok = new WebcastPushConnection(username, {
    ...(resolvedCookies && { requestOptions: { headers: { cookie: resolvedCookies } } }),
  });

  // --- Event Handlers ---
  tiktok.on("connected", (state) => {
    console.log("✅ Connected:", state.roomId);
    recentlyConnected = true;
    setTimeout(() => { recentlyConnected = false; }, 2000); // 2s window to suppress transient errors
    win.webContents.send("tiktok-status", { connected: true, roomId: state.roomId });
  });

  tiktok.on("disconnected", () => {
    console.log("⚠️ Disconnected");
    win.webContents.send("tiktok-status", { connected: false });
    speechQueue = [];
    isSpeaking = false;
    clearSeen();
  });

  tiktok.on("streamEnd", () => {
    console.log("🛑 Stream ended");
    win.webContents.send("tiktok-event", { type: "streamEnd" });
  });

  tiktok.on("chat", (data) => {
    const chatId = extractChatId(data);
    if (!rememberId(chatId)) return;

    const { nickname, uniqueId, userId, displayName } = extractUserFields(data);
    const rawMsg = (data?.comment ?? data?.text ?? "").trim();

    // Force username to appear even if UI only prints `message`
    const renderedMessage = displayName ? `${displayName}: ${rawMsg}` : rawMsg || displayName || "message";

    console.log("📥 Chat event:", chatId, renderedMessage);

    // Send EVERY common field + nested object
    win.webContents.send("tiktok-event", {
      type: "chat",
      id: chatId,
      // identity variants:
      user: displayName,
      username: uniqueId || displayName,
      displayName,
      nickname: nickname || displayName,
      uniqueId: uniqueId || null,
      userId: userId ?? null,
      userObj: { uniqueId: uniqueId || null, nickname: nickname || null, userId: userId ?? null, displayName },
      // messaging:
      message: renderedMessage,       // <-- UI that only renders `message` will now show "name: text"
      rawMessage: rawMsg,             // original text only
      meta: data,
    });

    if (rawMsg) enqueueSpeech(`${displayName} says ${rawMsg}`);
  });

  tiktok.on("like", (data) => {
    if (typeof data.totalLikeCount === "number") {
      totalLikes = data.totalLikeCount;
    } else {
      totalLikes += data.likeCount || 0;
    }
    const { nickname, uniqueId, userId, displayName } = extractUserFields(data);
    win.webContents.send("tiktok-event", {
      type: "like",
      user: displayName,
      username: uniqueId || displayName,
      displayName,
      nickname: nickname || displayName,
      uniqueId: uniqueId || null,
      userId: userId ?? null,
      userObj: { uniqueId: uniqueId || null, nickname: nickname || null, userId: userId ?? null, displayName },
      message: `${displayName} liked`,
      likes: totalLikes,
      meta: data,
    });
  });

  tiktok.on("follow", (data) => {
    const { nickname, uniqueId, userId, displayName } = extractUserFields(data);
    win.webContents.send("tiktok-event", {
      type: "follow",
      user: displayName,
      username: uniqueId || displayName,
      displayName,
      nickname: nickname || displayName,
      uniqueId: uniqueId || null,
      userId: userId ?? null,
      userObj: { uniqueId: uniqueId || null, nickname: nickname || null, userId: userId ?? null, displayName },
      message: `${displayName} followed!`,
      meta: data,
    });
    enqueueSpeech(`SOUND::sounds/follow.mp3`);
  });

  tiktok.on("gift", (data) => {
    const { nickname, uniqueId, userId, displayName } = extractUserFields(data);

    let msg = `${displayName} sent ${data.giftName}`;
    let soundFile = "sounds/small-gift.mp3";
    if (data.repeatEnd) {
      msg = `${displayName} sent a COMBO of ${data.giftName} x${data.repeatCount}`;
      soundFile = "sounds/multi-gift.mp3";
    } else if ((data.diamondCount || 0) >= 100) {
      msg = `${displayName} sent a BIG gift: ${data.giftName}`;
      soundFile = "sounds/big-gift.mp3";
    }

    win.webContents.send("tiktok-event", {
      type: "gift",
      user: displayName,
      username: uniqueId || displayName,
      displayName,
      nickname: nickname || displayName,
      uniqueId: uniqueId || null,
      userId: userId ?? null,
      userObj: { uniqueId: uniqueId || null, nickname: nickname || null, userId: userId ?? null, displayName },
      message: msg,
      meta: data,
    });
    enqueueSpeech(`SOUND::${soundFile}`);
  });

  tiktok.on("share", (data) => {
    const { nickname, uniqueId, userId, displayName } = extractUserFields(data);
    const msg = `${displayName} shared the stream!`;
    win.webContents.send("tiktok-event", {
      type: "share",
      user: displayName,
      username: uniqueId || displayName,
      displayName,
      nickname: nickname || displayName,
      uniqueId: uniqueId || null,
      userId: userId ?? null,
      userObj: { uniqueId: uniqueId || null, nickname: nickname || null, userId: userId ?? null, displayName },
      message: msg,
      meta: data,
    });
    enqueueSpeech(`SOUND::sounds/share.mp3`);
  });

  tiktok.on("error", (err) => {
    console.error("TikTok error:", err);
    // Suppress transient error right before a successful connect
    setTimeout(() => {
      if (!recentlyConnected) {
        win.webContents.send("tiktok-event", { type: "error", message: String(err?.message || err) });
      }
    }, 1200);
  });

  tiktok.connect().catch((err) => {
    console.error("❌ connect() failed:", err);
    setTimeout(() => {
      if (!recentlyConnected) {
        const msg = `❌ Failed to connect: ${err.message || err}`;
        win.webContents.send("tiktok-event", { type: "error", message: msg });
        win.webContents.send("tiktok-status", { connected: false });
      }
    }, 1200);
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
    win.loadURL("http://localhost:5173");
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
  isMuted = !!value;
  console.log(isMuted ? "🔇 Muted" : "🔊 Unmuted");
});
ipcMain.on("connect-tiktok", (_event, payload) => {
  const win = BrowserWindow.getFocusedWindow();
  const { username, cookies } = typeof payload === "object" ? payload : { username: payload, cookies: null };
  if (win && username) {
    console.log("🔗 Connecting to TikTok username:", username);
    connectTiktok(win, username, cookies);
  }
});

ipcMain.on("disconnect-tiktok", (_event) => {
  if (tiktok) {
    try {
      tiktok.removeAllListeners();
      tiktok.disconnect();
    } catch (err) {
      console.error("Error disconnecting:", err);
    }
    tiktok = null;
  }
  speechQueue = [];
  isSpeaking = false;
  totalLikes = 0;
  clearSeen();

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
