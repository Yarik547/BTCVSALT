import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
const PORT = 4000;
const BASE_URL = "https://api.coingecko.com/api/v3"; // <-- саме CoinGecko

app.use(cors()); // даємо браузеру CORS [web:108]

app.get("/api/coins/markets", async (req, res) => {
  try {
    const url = `${BASE_URL}/coins/markets?${new URLSearchParams(req.query)}`;
    const resp = await fetch(url);
    const data = await resp.text();
    res.status(resp.status).send(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "proxy error" });
  }
});

app.get("/api/coins/:id/market_chart", async (req, res) => {
  try {
    const { id } = req.params;
    const url = `${BASE_URL}/coins/${id}/market_chart?${new URLSearchParams(
      req.query
    )}`;
    const resp = await fetch(url);
    const data = await resp.text();
    res.status(resp.status).send(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "proxy error" });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy listening on http://localhost:${PORT}`);
});
