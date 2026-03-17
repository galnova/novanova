import React, { useEffect, useState } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  useNavigate,
} from "react-router-dom";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./App.css";

function Drawer({ isOpen, onClose }) {
  return (
    <>
      <div
        className={`overlay ${isOpen ? "show" : ""}`}
        onClick={onClose}
      ></div>

      <div className={`drawer ${isOpen ? "open" : ""}`}>
        <button className="drawer-close" onClick={onClose}>
          <i className="fas fa-times"></i>
        </button>
        <nav>
          <Link to="/" onClick={onClose}>
            <i className="fas fa-home"></i> Home
          </Link>
          <Link to="/about" onClick={onClose}>
            <i className="fas fa-info-circle"></i> About
          </Link>
          <Link to="/settings" onClick={onClose}>
            <i className="fas fa-cog"></i> Settings
          </Link>
        </nav>
      </div>
    </>
  );
}

function Home({ soundConfig }) {
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const [voice, setVoice] = useState("Zira");
  const [muted, setMuted] = useState(false);
  const [channelId, setChannelId] = useState(
    () => localStorage.getItem("ytChannelId") || ""
  );
  const [error, setError] = useState(null);

  const [likeCount, setLikeCount] = useState(0);
  const [followCount, setFollowCount] = useState(0);
  const [shareCount, setShareCount] = useState(0);
  const [chatCount, setChatCount] = useState(0);

  const [showTests, setShowTests] = useState(true);
  const [showSummary, setShowSummary] = useState(false);

  useEffect(() => {
    const eventHandler = (data) => {
      setEvents((prev) => [data, ...prev].slice(0, 50));

      if (data.type === "error") {
        setError(data.msg || data.message);
      }
      if (data.type === "like") {
        setLikeCount(data.likes || 0);
        checkMilestone(data.likes || 0);
      }
      if (data.type === "follow") {
        setFollowCount((prev) => prev + 1);
      }
      if (data.type === "share") {
        setShareCount((prev) => prev + 1);
      }
      if (data.type === "chat") {
        setChatCount((prev) => prev + 1);
      }
    };

    const statusHandler = (data) => {
      setConnected(data.connected);
      if (!data.connected) {
        setShowSummary(true);
      } else {
        setError(null);
      }
    };

    const listener1 = window.electronAPI?.onTiktokEvent(eventHandler);
    const listener2 = window.electronAPI?.onTiktokStatus(statusHandler);

    return () => {
      window.electronAPI?.removeTiktokEvent?.(listener1);
      window.electronAPI?.removeTiktokStatus?.(listener2);
    };
  }, []);

  const addTestEvent = (type, msg, sound = null, speak = false) => {
    const event = { type, message: msg };
    setEvents((prev) => [event, ...prev].slice(0, 50));
    if (sound) window.electronAPI?.playSound(sound);
    if (speak) window.electronAPI?.speak(msg);

    if (type === "like") {
      setLikeCount((prev) => {
        const newCount = prev + 1;
        checkMilestone(newCount);
        return newCount;
      });
    }
    if (type === "follow") setFollowCount((prev) => prev + 1);
    if (type === "share") setShareCount((prev) => prev + 1);
    if (type === "chat") setChatCount((prev) => prev + 1);
  };

  const celebratoryWords = [
    "Amazing",
    "Spectacular",
    "Fantastic",
    "Exciting",
    "Awesome",
    "Brilliant",
    "Incredible",
    "Outstanding",
    "Wonderful",
    "Epic",
  ];

  const getRandomWord = () => {
    return celebratoryWords[
      Math.floor(Math.random() * celebratoryWords.length)
    ];
  };

  const checkMilestone = (count) => {
    let isMilestone = false;
    if (count <= 500 && count % 100 === 0) {
      isMilestone = true;
    } else if (count > 500 && count <= 10000 && count % 500 === 0) {
      isMilestone = true;
    } else if (count > 10000 && count % 1000 === 0) {
      isMilestone = true;
    }

    if (isMilestone) {
      const word = getRandomWord();
      window.electronAPI?.speak(`${count} likes... ${word}!`);
    }
  };

  const toggleVoice = () => {
    const newVoice = voice === "Zira" ? "David" : "Zira";
    setVoice(newVoice);
    window.electronAPI?.setVoice(newVoice);
  };

  const toggleMute = () => {
    const newMuted = !muted;
    setMuted(newMuted);
    window.electronAPI?.setMute(newMuted);
  };

  const handleConnect = () => {
    const apiKey = localStorage.getItem("ytApiKey") || "";
    if (!channelId.trim()) {
      setError("❌ Please enter a YouTube Channel ID first!");
      return;
    }
    if (!apiKey.trim()) {
      setError("❌ YouTube API Key is missing. Add it in Settings.");
      return;
    }
    localStorage.setItem("ytChannelId", channelId.trim());
    window.electronAPI?.connectYoutube(apiKey.trim(), channelId.trim());
    setError(null);
    setShowSummary(false);
    setLikeCount(0);
    setFollowCount(0);
    setShareCount(0);
    setChatCount(0);
  };

  const handleDisconnect = () => {
    window.electronAPI?.disconnectYoutube?.();
    setConnected(false);
    setShowSummary(true);
  };

  return (
    <div className="App">
      <div className="status-header">
        <div
          className={`status-bar ${connected ? "connected" : "disconnected"}`}
        >
          {connected ? (
            <>
              <i className="fas fa-circle" style={{ color: "#22c55e" }}></i>{" "}
              Connected to YouTube
            </>
          ) : (
            <>
              <i className="fas fa-circle" style={{ color: "#ef4444" }}></i>{" "}
              Disconnected
            </>
          )}
        </div>
        <HamburgerMenu />
      </div>

      <h1>YouTube Live Bot</h1>

      <div className="username-input">
        <div className="username-group">
          <div className="username-row">
            <input
              type="text"
              placeholder="Enter YouTube Channel ID (UCxxx...)"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
            />
            <button
              onClick={handleConnect}
              className={error ? "error" : connected ? "connected" : ""}
            >
              {error ? (
                <>
                  <i className="fas fa-times-circle"></i> Failed
                </>
              ) : connected ? (
                <>
                  <i className="fas fa-check-circle"></i> Connected
                </>
              ) : (
                <>
                  <i className="fas fa-plug"></i> Connect
                </>
              )}
            </button>
            {connected && (
              <button onClick={handleDisconnect} className="disconnect-btn">
                <i className="fas fa-plug"></i> Disconnect
              </button>
            )}
          </div>
          {error && <div className="error-banner attached">{error}</div>}
        </div>
      </div>

      {/* Like Counter */}
      <div className="like-counter">
        <i className="fas fa-heart"></i> Likes: {likeCount}
      </div>

      <div className="controls">
        <button onClick={toggleVoice}>
          <i className="fas fa-microphone"></i> Current Voice: {voice}
        </button>
        <button onClick={toggleMute}>
          {muted ? (
            <>
              <i className="fas fa-microphone-slash"></i> Unmute
            </>
          ) : (
            <>
              <i className="fas fa-microphone"></i> Mute
            </>
          )}
        </button>
      </div>

      {/* Collapsible Test Controls */}
      <h2>
        <button
          className="collapsible"
          onClick={() => setShowTests((prev) => !prev)}
        >
          <i className="fas fa-vial"></i> Test Controls
          <i
            className={`fas ${showTests ? "fa-chevron-up" : "fa-chevron-down"}`}
            style={{ marginLeft: "8px" }}
          ></i>
        </button>
      </h2>

      {showTests && (
        <div className="test-controls">
          <button
            onClick={() =>
              addTestEvent("chat", "User123 says Hello World!", null, true)
            }
          >
            <i className="fas fa-comment"></i> Test Chat
          </button>
          <button
            onClick={() =>
              addTestEvent(
                "gift",
                "User456 sent a Rose 🌹",
                soundConfig.smallGift
              )
            }
          >
            <i className="fas fa-gift"></i> Test Small Gift
          </button>
          <button
            onClick={() =>
              addTestEvent(
                "gift",
                "User789 sent a BIG gift 🎁",
                soundConfig.bigGift
              )
            }
          >
            <i className="fas fa-gifts"></i> Test Big Gift
          </button>
          <button
            onClick={() =>
              addTestEvent(
                "gift",
                "User999 sent a COMBO gift 🎉",
                soundConfig.multiGift
              )
            }
          >
            <i className="fas fa-gifts"></i> Test Multi Gift
          </button>
          <button onClick={() => addTestEvent("like", "User321 liked ❤️")}>
            <i className="fas fa-thumbs-up"></i> Test Like
          </button>
          <button
            onClick={() =>
              addTestEvent("follow", "User654 followed! ✅", soundConfig.follow)
            }
          >
            <i className="fas fa-user-plus"></i> Test Follow
          </button>
          <button
            onClick={() =>
              addTestEvent("share", "User111 shared! 🔄", soundConfig.share)
            }
          >
            <i className="fas fa-share"></i> Test Share
          </button>
        </div>
      )}

      <div className="events">
        {events.map((e, i) => (
          <div key={i} className={`event ${e.type}`}>
            <strong>[{e.type}]</strong> {e.message || e.msg}
          </div>
        ))}
      </div>

      {/* Session Summary Modal */}
      {showSummary && (
        <div className="modal-overlay">
          <div className="modal">
            <button
              className="modal-close"
              onClick={() => setShowSummary(false)}
            >
              <i className="fas fa-times"></i>
            </button>
            <h2>📊 Session Summary</h2>
            <ul>
              <li>
                <i className="fas fa-heart"></i> Likes: {likeCount}
              </li>
              <li>
                <i className="fas fa-user-plus"></i> Follows: {followCount}
              </li>
              <li>
                <i className="fas fa-share"></i> Shares: {shareCount}
              </li>
              <li>
                <i className="fas fa-comment"></i> Comments: {chatCount}
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function HamburgerMenu() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <>
      <button className="hamburger" onClick={() => setDrawerOpen(true)}>
        <i className="fas fa-bars"></i>
      </button>
      <Drawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}

function About() {
  const navigate = useNavigate();
  return (
    <div className="sub-page">
      <button onClick={() => navigate(-1)}>
        <i className="fas fa-arrow-left"></i> Back
      </button>
      <h1>About</h1>
      <p>
        Hi, I’m <strong>Keith Jeter</strong> — a web/app developer, artist, and
        designer. I built this TikTok Live Bot as a free tool for creators like
        you.
      </p>
      <p>
        You’re welcome to use it for free. If you’d like to support my work,
        donations are very appreciated:
      </p>
      <p>
        <a
          href="https://www.paypal.com/paypalme/greyvoth"
          target="_blank"
          rel="noopener noreferrer"
          className="donate-btn"
        >
          <i className="fas fa-heart"></i> Donate via PayPal
        </a>
      </p>
    </div>
  );
}

function Settings({ soundConfig, setSoundConfig }) {
  const navigate = useNavigate();
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("ytApiKey") || "");
  const [channelId, setChannelId] = useState(() => localStorage.getItem("ytChannelId") || "");
  const [credsSaved, setCredsSaved] = useState(false);

  const handleInputChange = (key, value) => {
    setSoundConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveCreds = () => {
    localStorage.setItem("ytApiKey", apiKey.trim());
    localStorage.setItem("ytChannelId", channelId.trim());
    setCredsSaved(true);
    setTimeout(() => setCredsSaved(false), 2000);
  };

  const fieldStyle = {
    width: "100%", marginBottom: "12px", fontFamily: "monospace",
    fontSize: "12px", background: "#1a1a2e", color: "#cdd6f4",
    border: "1px solid #444", borderRadius: "6px", padding: "8px",
  };

  return (
    <div className="sub-page">
      <button onClick={() => navigate(-1)}>
        <i className="fas fa-arrow-left"></i> Back
      </button>
      <h1>Settings</h1>

      <div className="settings-section">
        <h3>YouTube API Credentials</h3>
        <p className="settings-tip">
          Required to connect to YouTube live streams. Get a free API key at{" "}
          <strong>console.cloud.google.com</strong> — create a project, enable{" "}
          <strong>YouTube Data API v3</strong>, then create an API key. The
          Channel ID starts with <code>UC</code> and is found in the channel
          URL (youtube.com/channel/<code>UCxxxxxx</code>).
        </p>
        <label style={{ display: "block", marginBottom: "4px" }}>API Key</label>
        <input
          type="password"
          style={fieldStyle}
          placeholder="AIza..."
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <label style={{ display: "block", marginBottom: "4px" }}>Channel ID</label>
        <input
          type="text"
          style={fieldStyle}
          placeholder="UCxxxxxxxxxxxxxxxxxxxxxxxx"
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
        />
        <button onClick={handleSaveCreds} style={{ marginTop: "4px" }}>
          {credsSaved ? (
            <><i className="fas fa-check-circle"></i> Saved!</>
          ) : (
            <><i className="fas fa-save"></i> Save</>
          )}
        </button>
      </div>

      <div className="settings-section">
        <h3>Sound Files</h3>
        <p className="settings-tip">
          Place your custom sound files inside the <code>sounds/</code> folder
          at the root of this app. Keep them at or under{" "}
          <strong>5 seconds</strong> for best results. For fun sound downloads,
          check{" "}
          <a
            href="https://www.myinstants.com/en/index/us/"
            target="_blank"
            rel="noopener noreferrer"
          >
            MyInstants.com
          </a>
          .
        </p>
        {Object.entries(soundConfig).map(([key, value]) => (
          <div key={key} className="settings-item">
            <strong>{key}</strong>
            <input
              type="text"
              value={value}
              onChange={(e) => handleInputChange(key, e.target.value)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RootApp() {
  const [soundConfig, setSoundConfig] = useState(() => {
    const saved = localStorage.getItem("soundConfig");
    return saved
      ? JSON.parse(saved)
      : {
          smallGift: "sounds/small-gift.mp3",
          bigGift: "sounds/big-gift.mp3",
          multiGift: "sounds/multi-gift.mp3",
          follow: "sounds/follow.mp3",
          share: "sounds/share.mp3",
        };
  });

  useEffect(() => {
    localStorage.setItem("soundConfig", JSON.stringify(soundConfig));
  }, [soundConfig]);

  return (
    <Router>
      <main>
        <Routes>
          <Route path="/" element={<Home soundConfig={soundConfig} />} />
          <Route path="/about" element={<About />} />
          <Route
            path="/settings"
            element={
              <Settings
                soundConfig={soundConfig}
                setSoundConfig={setSoundConfig}
              />
            }
          />
        </Routes>
      </main>
    </Router>
  );
}
