// signServer.js
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { WebcastPushConnection } from "tiktok-live-connector";

const app = express();
const PORT = 8080;

app.use(cors());
app.use(bodyParser.json());

// Dummy connection for signing
const signer = new WebcastPushConnection("__dummy__");

app.post("/sign", async (req, res) => {
  try {
    const signed = await signer.sign(req.body);
    res.json(signed);
  } catch (err) {
    console.error("Sign error:", err);
    res.status(500).json({ error: "Failed to sign request" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Local TikTok Sign Server running at http://localhost:${PORT}/sign`);
});
