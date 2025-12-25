import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
const PORT = 4000;

// базовий URL CryptoCompare
const BASE_URL = "https://min-api.cryptocompare.com";

// простий кеш у пам'яті
const cache = new Map();
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 хвилини

function getCacheKey(url) {
  return url;
}

async function cachedFetch(url) {
  const key = getCacheKey(url);
  const now = Date.now();
  const entry = cache.get(key);
  if (entry && now - entry.time < CACHE_TTL_MS) {
    return entry.data;
  }
  const resp = await fetch(url);
  const text = await resp.text();
  const data = { status: resp.status, body: text };
  cache.set(key, { time: now, data });
  return data;
}

app.use(cors());

// топ монет за маркеткапом
app.get("/api/top-mktcap", async (req, res) => {
  try {
    const { limit = 10, tsym = "USD" } = req.query;
    const url = `${BASE_URL}/data/top/mktcapfull?tsym=${tsym}&limit=${limit}`;
    const { status, body } = await cachedFetch(url);
    res.status(status).send(body);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "proxy error" });
  }
});

// історія (годинні свічки)
app.get("/api/histohour", async (req, res) => {
  try {
    const { fsym, tsym = "USD", limit = 200 } = req.query;
    if (!fsym) {
      return res.status(400).json({ error: "fsym required" });
    }
    const url = `${BASE_URL}/data/v2/histohour?fsym=${fsym}&tsym=${tsym}&limit=${limit}`;
    const { status, body } = await cachedFetch(url);
    res.status(status).send(body);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "proxy error" });
  }
});

app.listen(PORT, () => {
  console.log(`CryptoCompare proxy listening on http://localhost:${PORT}`);
});
