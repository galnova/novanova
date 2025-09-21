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
      {/* Overlay */}
      <div
        className={`overlay ${isOpen ? "show" : ""}`}
        onClick={onClose}
      ></div>

      {/* Drawer */}
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
  const [username, setUsername] = useState("");
  const [error, setError] = useState(null);
  const [likeCount, setLikeCount] = useState(0);
  const [showTests, setShowTests] = useState(true);

  useEffect(() => {
    window.electronAPI?.onTiktokEvent((data) => {
      setEvents((prev) => [data, ...prev].slice(0, 50));

      if (data.type === "error") {
        setError(data.msg);
      }

      if (data.type === "like") {
        setLikeCount((prev) => {
          const newCount = prev + 1;
          checkMilestone(newCount);
          return newCount;
        });
      }
    });

    window.electronAPI?.onTiktokStatus((data) => {
      setConnected(data.connected);
      if (data.connected) setError(null);
    });
  }, []);

  const addTestEvent = (type, msg, sound = null, speak = false) => {
    const event = { type, msg };
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
    if (!username.trim()) {
      setError("❌ Failed: Please enter a username first!");
      return;
    }

    window.electronAPI?.connectTiktok(username.trim());
    setError(null);
  };

  return (
    <div className="App">
      <div className="status-header">
        <div
          className={`status-bar ${
            connected ? "connected" : "disconnected"
          }`}
        >
          {connected ? (
            <>
              <i className="fas fa-circle" style={{ color: "#22c55e" }}></i>{" "}
              Connected to TikTok
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

      <h1>TikTok Live Bot</h1>

      <div className="username-input">
        <div className="username-group">
          <div className="username-row">
            <input
              type="text"
              placeholder="Enter TikTok username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
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
            className={`fas ${
              showTests ? "fa-chevron-up" : "fa-chevron-down"
            }`}
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
                "small-gift",
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
                "big-gift",
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
                "multi-gift",
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
              addTestEvent(
                "follow",
                "User654 followed! ✅",
                soundConfig.follow
              )
            }
          >
            <i className="fas fa-user-plus"></i> Test Follow
          </button>
          <button
            onClick={() =>
              addTestEvent(
                "share",
                "User111 shared! 🔄",
                soundConfig.share
              )
            }
          >
            <i className="fas fa-share"></i> Test Share
          </button>
        </div>
      )}

      <div className="events">
        {events.map((e, i) => (
          <div key={i} className={`event ${e.type}`}>
            <strong>[{e.type}]</strong> {e.msg}
          </div>
        ))}
      </div>
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

  const handleInputChange = (key, value) => {
    setSoundConfig((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="sub-page">
      <button onClick={() => navigate(-1)}>
        <i className="fas fa-arrow-left"></i> Back
      </button>
      <h1>Settings</h1>
      <p className="settings-tip">
        Place your custom sound files inside the <code>sounds/</code> folder at
        the root of this app. Keep them at or under <strong>5 seconds</strong>{" "}
        for best results. For fun sound downloads, check{" "}
        <a
          href="https://www.myinstants.com/en/index/us/"
          target="_blank"
          rel="noopener noreferrer"
        >
          MyInstants.com
        </a>
        .
      </p>

      <div className="settings-section">
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

  // Save to localStorage whenever config changes
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
