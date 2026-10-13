const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const readline = require("readline");
const fs = require("fs");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, ".env") });
process.env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = "true";

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

// Long-running PowerShell process that speaks one request per line of
// stdin and prints "DONE" after each. Spawning a fresh PowerShell per
// chat message (the old approach) adds well over half a second of
// startup overhead each time, which let the speech queue fall behind
// during busy chat and silently drop messages (see enqueueSpeech).
// Keeping one process alive removes that overhead almost entirely.
const TTS_SERVER_SCRIPT =
  "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; " +
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; " +
  "Add-Type -AssemblyName System.Speech; " +
  "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; " +
  "$currentVoice = $null; " +
  "while ($true) { " +
  "  $line = [Console]::In.ReadLine(); " +
  "  if ($null -eq $line) { break }; " +
  "  if ($line) { " +
  "    try { " +
  "      $req = $line | ConvertFrom-Json; " +
  "      if ($req.voice -and $req.voice -ne $currentVoice) { " +
  "        try { $s.SelectVoice($req.voice); $currentVoice = $req.voice } catch {} " +
  "      }; " +
  "      $pb = New-Object System.Speech.Synthesis.PromptBuilder; " +
  "      foreach ($seg in $req.segments) { " +
  "        if ($seg.p) { $pb.AppendTextWithPronunciation($seg.t, $seg.p) } " +
  "        else { $pb.AppendText($seg.t) } " +
  "      }; " +
  "      $s.Speak($pb); " +
  "    } catch {} " +
  "  }; " +
  "  Write-Output 'DONE'; " +
  "}";

let ttsProcess = null;
let ttsDoneQueue = [];

function startTtsProcess() {
  const proc = spawn(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", TTS_SERVER_SCRIPT],
    { stdio: ["pipe", "pipe", "pipe"] }
  );
  readline.createInterface({ input: proc.stdout }).on("line", (line) => {
    if (line.trim() === "DONE") {
      const resolve = ttsDoneQueue.shift();
      if (resolve) resolve();
    }
  });
  proc.stderr.on("data", () => {});
  proc.on("exit", () => {
    if (ttsProcess === proc) ttsProcess = null;
    const pending = ttsDoneQueue;
    ttsDoneQueue = [];
    pending.forEach((resolve) => resolve());
  });
  proc.on("error", (err) => {
    console.error("TTS process error:", err);
  });
  return proc;
}

function getTtsProcess() {
  if (!ttsProcess) ttsProcess = startTtsProcess();
  return ttsProcess;
}

// "live" is a heteronym: System.Speech's default guess pronounces it to
// rhyme with "give" (the verb). We always want the broadcast sense, to
// rhyme with "strive" (like "Saturday Night Live"), so force it with an
// explicit IPA pronunciation instead of letting the engine's heuristics
// decide per-sentence. AppendTextWithPronunciation requires true IPA
// characters with no separators (e.g. "ɪ", not ascii "I" or "ih1").
const LIVE_PRONUNCIATION = "laɪv";

function buildTtsSegments(text) {
  return text
    .split(/\b(live)\b/i)
    .filter((part) => part.length > 0)
    .map((part) =>
      /^live$/i.test(part) ? { t: part, p: LIVE_PRONUNCIATION } : { t: part }
    );
}

function speak(text) {
  return new Promise((resolve) => {
    const safe = safePsString(text);
    if (!safe) { resolve(); return; }
    const payload = JSON.stringify({ voice: TTS_VOICE, segments: buildTtsSegments(safe) });
    try {
      const proc = getTtsProcess();
      ttsDoneQueue.push(resolve);
      proc.stdin.write(payload + "\n");
    } catch (err) {
      console.error("TTS Error:", err);
      resolve();
    }
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

const SPEECH_QUEUE_MAX = 30;

function enqueueSpeech(text) {
  if (isMuted) return;
  if (speechQueue.length >= SPEECH_QUEUE_MAX) {
    speechQueue.splice(0, speechQueue.length - (SPEECH_QUEUE_MAX - 1));
  }
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

    const SHARE_SPAM_THRESHOLD = 5;
    const SHARE_STREAK_RESET_MS = 60000;
    const shareStreaks = new Map();
    function isShareSpam(userKey) {
      const now = Date.now();
      const streak = shareStreaks.get(userKey) || { count: 0, last: 0 };
      if (now - streak.last > SHARE_STREAK_RESET_MS) streak.count = 0;
      streak.count += 1;
      streak.last = now;
      shareStreaks.set(userKey, streak);
      if (shareStreaks.size > 3000) shareStreaks.delete(shareStreaks.keys().next().value);
      return streak.count > SHARE_SPAM_THRESHOLD;
    }

    // Viewers drop these compliment call-outs a lot; answer with a
    // follow nudge instead of reading the raw slang back out loud.
    const COMPLIMENT_REGEX = /\bg+y+a+t+\b|\bcakes?\b|\bo+u*\s*shi+\b/i;
    const COMPLIMENT_REPLY = "Please follow Greyvoth and thanks for the compliments.";

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
      if (COMPLIMENT_REGEX.test(msg)) {
        enqueueSpeech(COMPLIMENT_REPLY);
        return;
      }
      const ttsName = safePsString(user) || data.uniqueId || "someone";
      const ttsMsg = safePsString(msg);
      enqueueSpeech(ttsMsg ? `${ttsName} says ${ttsMsg}` : `${ttsName} sent a message`);
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
        const userKey = data.uniqueId || user;
        const spam = isShareSpam(userKey);
        win.webContents.send("tiktok-event", {
          type: "share",
          user,
          message: `${user} shared!`,
          spam,
        });
        if (!spam) {
          const ttsName = safePsString(user) || data.uniqueId || "someone";
          enqueueSpeech(`Thank you ${ttsName} for the share!`);
        }
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
    console.log(`Connected to @${username}'s live`);

  } catch (err) {
    console.error("Connect error:", err);
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
    try { tiktokConnection.removeAllListeners(); } catch (e) {}
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

ipcMain.on("connect-tiktok", (event, username) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && username) {
    console.log(`Connecting to @${username}...`);
    connectTiktok(win, username);
  } else if (win) {
    win.webContents.send("tiktok-event", {
      type: "error",
      message: "Please enter a TikTok username.",
    });
  }
});

ipcMain.on("disconnect-tiktok", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
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

app.on("before-quit", () => {
  if (ttsProcess) ttsProcess.kill();
});
