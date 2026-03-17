import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "path";
import { fileURLToPath } from "url";
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

// --- YouTube polling state ---
let ytPoller = null;

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

// --- YouTube API helpers ---
async function ytFetch(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API ${res.status}: ${body}`);
  }
  return res.json();
}

async function resolveLiveChatId(apiKey, channelId) {
  const searchUrl =
    `https://www.googleapis.com/youtube/v3/search` +
    `?part=id&channelId=${encodeURIComponent(channelId)}` +
    `&eventType=live&type=video&key=${encodeURIComponent(apiKey)}`;
  const searchData = await ytFetch(searchUrl);

  const videoId = searchData?.items?.[0]?.id?.videoId;
  if (!videoId) throw new Error("No active live stream found for this channel.");

  const videoUrl =
    `https://www.googleapis.com/youtube/v3/videos` +
    `?part=liveStreamingDetails&id=${encodeURIComponent(videoId)}` +
    `&key=${encodeURIComponent(apiKey)}`;
  const videoData = await ytFetch(videoUrl);

  const chatId = videoData?.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
  if (!chatId) throw new Error("Live stream found but has no active chat.");
  return chatId;
}

function mapYtItemToEvent(item) {
  const snippet = item.snippet || {};
  const author = item.authorDetails || {};
  const type = snippet.type;

  const displayName = author.displayName || "unknown_user";
  const userId = author.channelId || null;
  const chatId = item.id || `${userId}-${snippet.publishedAt}`;

  let internalType, message, soundFile;

  if (type === "textMessageEvent") {
    internalType = "chat";
    const rawMsg = snippet.displayMessage || "";
    message = `${displayName}: ${rawMsg}`;

  } else if (type === "superChatEvent") {
    internalType = "gift";
    const amount = snippet.superChatDetails?.amountDisplayString || "";
    const tier = snippet.superChatDetails?.tier || 1;
    message = `${displayName} sent a Super Chat: ${amount}`;
    soundFile = tier >= 4 ? "sounds/big-gift.mp3" : "sounds/small-gift.mp3";

  } else if (type === "superStickerEvent") {
    internalType = "gift";
    const amount = snippet.superStickerDetails?.amountDisplayString || "";
    message = `${displayName} sent a Super Sticker: ${amount}`;
    soundFile = "sounds/small-gift.mp3";

  } else if (type === "newSponsorEvent" || type === "memberMilestoneChatEvent") {
    internalType = "follow";
    const months = snippet.memberMilestoneChatDetails?.memberMonth || null;
    message = months
      ? `${displayName} has been a member for ${months} months!`
      : `${displayName} became a member!`;
    soundFile = "sounds/follow.mp3";

  } else {
    return null;
  }

  return { internalType, chatId, displayName, userId, message, soundFile, rawItem: item };
}

// --- YouTube connection ---
function connectYoutube(win, apiKey, channelId) {
  disconnectYoutube(win, false);
  clearSeen();
  speechQueue = [];
  isSpeaking = false;

  let aborted = false;

  // Store abort handle immediately so disconnectYoutube can cancel during resolve
  ytPoller = { abort: () => { aborted = true; } };

  resolveLiveChatId(apiKey, channelId)
    .then((liveChatId) => {
      if (aborted) return;
      ytLiveChatId = liveChatId;
      console.log("✅ Connected to YouTube live chat:", liveChatId);
      win.webContents.send("tiktok-status", { connected: true, roomId: liveChatId });

      let pageToken = null;
      let pollDelayMs = 5000;
      let firstPoll = true;

      async function poll() {
        if (aborted) return;
        try {
          let url =
            `https://www.googleapis.com/youtube/v3/liveChat/messages` +
            `?liveChatId=${encodeURIComponent(liveChatId)}` +
            `&part=snippet,authorDetails&maxResults=200` +
            `&key=${encodeURIComponent(apiKey)}`;
          if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;

          const data = await ytFetch(url);
          pageToken = data.nextPageToken || pageToken;

          const apiInterval = data.pollingIntervalMillis;
          if (typeof apiInterval === "number" && apiInterval > 0) {
            pollDelayMs = Math.max(apiInterval, 2000);
          }

          // Skip first batch — these are historical messages from before we connected
          if (firstPoll) {
            firstPoll = false;
            if (!aborted) ytPoller = setTimeout(poll, pollDelayMs);
            return;
          }

          for (const item of data.items || []) {
            const mapped = mapYtItemToEvent(item);
            if (!mapped) continue;

            const { internalType, chatId, displayName, userId, message, soundFile, rawItem } = mapped;
            if (!rememberId(chatId)) continue;

            win.webContents.send("tiktok-event", {
              type: internalType,
              id: chatId,
              user: displayName,
              username: displayName,
              displayName,
              nickname: displayName,
              uniqueId: userId,
              userId,
              message,
              rawMessage: rawItem?.snippet?.displayMessage || "",
              meta: rawItem,
            });

            if (internalType === "chat") {
              const rawMsg = rawItem?.snippet?.displayMessage || "";
              if (rawMsg) enqueueSpeech(`${displayName} says ${rawMsg}`);
            } else if (internalType === "gift") {
              enqueueSpeech(`SOUND::${soundFile}`);
            } else if (internalType === "follow") {
              enqueueSpeech(`SOUND::sounds/follow.mp3`);
            }
          }
        } catch (err) {
          console.error("YouTube poll error:", err);
          if (!aborted) {
            win.webContents.send("tiktok-event", {
              type: "error",
              message: String(err?.message || err),
            });
          }
        }

        if (!aborted) ytPoller = setTimeout(poll, pollDelayMs);
      }

      poll();
    })
    .catch((err) => {
      console.error("❌ YouTube connect error:", err);
      if (!aborted) {
        win.webContents.send("tiktok-event", {
          type: "error",
          message: `Failed to connect: ${err.message || err}`,
        });
        win.webContents.send("tiktok-status", { connected: false });
      }
    });
}

function disconnectYoutube(win, notify = true) {
  if (ytPoller) {
    if (typeof ytPoller === "object" && ytPoller.abort) {
      ytPoller.abort();
    } else {
      clearTimeout(ytPoller);
    }
    ytPoller = null;
  }
  speechQueue = [];
  isSpeaking = false;
  clearSeen();
  if (notify && win) {
    win.webContents.send("tiktok-status", { connected: false });
  }
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

ipcMain.on("connect-youtube", (_event, payload) => {
  const win = BrowserWindow.getFocusedWindow();
  const { apiKey, channelId } = typeof payload === "object" ? payload : {};
  if (win && apiKey && channelId) {
    console.log("🔗 Connecting to YouTube channel:", channelId);
    connectYoutube(win, apiKey, channelId);
  } else if (win) {
    win.webContents.send("tiktok-event", {
      type: "error",
      message: "API Key and Channel ID are required. Go to Settings.",
    });
  }
});

ipcMain.on("disconnect-youtube", (_event) => {
  const win = BrowserWindow.getFocusedWindow();
  disconnectYoutube(win, true);
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
