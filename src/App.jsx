import React, { useEffect, useState } from "react";
import "./App.css";

function App() {
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const [voice, setVoice] = useState("Zira");

  useEffect(() => {
    // TikTok events from main
    window.electronAPI?.onTiktokEvent((data) => {
      console.log("📩 Got event in React:", data);
      setEvents((prev) => [...prev.slice(-50), data]);
    });

    // Connection status
    window.electronAPI?.onTiktokStatus((data) => {
      console.log("🔌 Status event in React:", data);
      setConnected(data.connected);
    });
  }, []);

  // Fake test events
  const addTestEvent = (type, msg, sound = null, speak = false) => {
    const event = { type, msg };
    setEvents((prev) => [...prev.slice(-50), event]);

    // Send through IPC to play sound / speak
    if (sound) {
      window.electronAPI?.playSound(sound);
    }
    if (speak) {
      window.electronAPI?.speak(msg);
    }
  };

  // Toggle voice (frontend only — backend is locked to Zira right now)
  const toggleVoice = () => {
    const newVoice = voice === "Zira" ? "David" : "Zira";
    setVoice(newVoice);
    window.electronAPI?.setVoice(newVoice);
  };

  return (
    <div className="App">
      {/* Status Bar */}
      <div className={`status-bar ${connected ? "connected" : "disconnected"}`}>
        {connected ? "🟢 Connected to TikTok" : "🔴 Disconnected"}
      </div>

      <h1>TikTok Live Bot</h1>

      {/* Voice Toggle */}
      <button onClick={toggleVoice} className="voice-toggle">
        🎤 Current Voice: {voice}
      </button>

      {/* Test buttons */}
      <div className="test-controls">
        <button
          onClick={() =>
            addTestEvent("chat", "User123 says Hello World!", null, true)
          }
        >
          Test Chat
        </button>
        <button
          onClick={() =>
            addTestEvent(
              "small-gift",
              "User456 sent a Rose 🌹",
              "sounds/small-gift.mp3"
            )
          }
        >
          Test Small Gift
        </button>
        <button
          onClick={() =>
            addTestEvent(
              "big-gift",
              "User789 sent a BIG gift 🎁",
              "sounds/big-gift.mp3"
            )
          }
        >
          Test Big Gift
        </button>
        <button
          onClick={() =>
            addTestEvent(
              "multi-gift",
              "User999 sent a COMBO gift 🎉",
              "sounds/multi-gift.mp3"
            )
          }
        >
          Test Multi Gift
        </button>
        <button
          onClick={() =>
            addTestEvent("like", "User321 liked ❤️", "sounds/like.mp3")
          }
        >
          Test Like
        </button>
        <button
          onClick={() =>
            addTestEvent("follow", "User654 followed! ✅", "sounds/follow.mp3")
          }
        >
          Test Follow
        </button>
        <button
          onClick={() =>
            addTestEvent("share", "User111 shared! 🔄", "sounds/share.mp3")
          }
        >
          Test Share
        </button>
      </div>

      {/* Event log */}
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

export default App;
