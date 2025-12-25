// ---------- налаштування ----------

const VS = "USD"; // CryptoCompare чутливий до регістру
const BASE_URL = "http://localhost:4000/api";

const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const tableBody = document.getElementById("tableBody");
const reloadBtn = document.getElementById("reloadBtn");
const windowInput = document.getElementById("window");
const daysInput = document.getElementById("days");
const customIdInput = document.getElementById("customId");
const addBtn = document.getElementById("addBtn");

const LS_KEY = "btc_alt_custom_symbols";
let customIds = new Set(JSON.parse(localStorage.getItem(LS_KEY) || "[]"));
let currentRows = [];

function saveCustomIds() {
  localStorage.setItem(LS_KEY, JSON.stringify([...customIds]));
}

// ---------- утиліти ----------

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// топ монет за маркеткапом (BTC + інші)
async function getTopCoins(limit = 10) {
  const url = `${BASE_URL}/top-mktcap?tsym=${VS}&limit=${limit}`;
  const data = await fetchJson(url);

  if (data.Response === "Error") {
    throw new Error(data.Message || "CryptoCompare error");
  }

  const raw = data.Data;
  if (!Array.isArray(raw)) {
    console.error("top-mktcap unexpected:", data);
    throw new Error("Unexpected top-mktcap response format");
  }

  const list = raw
    .map((d, idx) => {
      const info = d.CoinInfo || {};
      return {
        symbol: info.Name, // BTC, ETH, ...
        name: info.FullName || info.Name,
        market_cap_rank: idx + 1,
      };
    })
    .filter((c) => c.symbol);

  return list;
}

// історія годинних свічок (close) [web:177]
async function getHistory(symbol, days) {
  const hours = Math.min(days * 24, 500); // запас по ліміту
  const url = `${BASE_URL}/histohour?fsym=${symbol}&tsym=${VS}&limit=${hours}`;
  const data = await fetchJson(url);
  if (data.Response === "Error") {
    throw new Error(data.Message || "histohour error");
  }
  return data.Data.Data || [];
}

// перетворення свічок у ретерни
function toReturnsFromCandles(candles) {
  const returns = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    const p = candles[i].close;
    if (!prev) continue;
    const r = (p - prev) / prev;
    returns.push({ t: candles[i].time * 1000, r });
  }
  return returns;
}

function syncReturns(retA, retB, toleranceMs = 60_000) {
  const outA = [];
  const outB = [];
  let j = 0;
  for (let i = 0; i < retA.length; i++) {
    const { t: tA, r: rA } = retA[i];
    while (j < retB.length && retB[j].t < tA - toleranceMs) j++;
    if (j >= retB.length) break;
    const { t: tB, r: rB } = retB[j];
    if (Math.abs(tA - tB) <= toleranceMs) {
      outA.push(rA);
      outB.push(rB);
    }
  }
  return [outA, outB];
}

// ковзна кореляція Пірсона
function rollingCorrelation(arrA, arrB, window) {
  const n = Math.min(arrA.length, arrB.length);
  if (n < window) return null;

  const start = n - window;
  const end = n;

  let sumA = 0,
    sumB = 0;
  for (let i = start; i < end; i++) {
    sumA += arrA[i];
    sumB += arrB[i];
  }
  const len = end - start;
  const meanA = sumA / len;
  const meanB = sumB / len;

  let num = 0,
    denA = 0,
    denB = 0;
  for (let i = start; i < end; i++) {
    const da = arrA[i] - meanA;
    const db = arrB[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  if (den === 0) return null;
  return num / den;
}

// ---------- рендер таблиці ----------

function renderTable() {
  tableBody.innerHTML = "";
  currentRows.forEach((row, i) => {
    const tr = document.createElement("tr");
    const corrFormatted = row.corr === null ? "–" : row.corr.toFixed(3);
    const corrClass =
      row.corr === null ? "" : row.corr >= 0 ? "corr-pos" : "corr-neg";

    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${row.name}</td>
      <td><span class="badge">${row.symbol}</span></td>
      <td>${row.market_cap_rank ?? "-"}</td>
      <td class="${corrClass}">${corrFormatted}</td>
      <td><button data-id="${row.symbol}" class="remove-btn">Видалити</button></td>
    `;
    tableBody.appendChild(tr);
  });

  document.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sym = btn.getAttribute("data-id");
      currentRows = currentRows.filter((r) => r.symbol !== sym);
      customIds.delete(sym);
      saveCustomIds();
      renderTable();
    });
  });
}

// ---------- обчислення для монети ----------

async function computeCorrForSymbol(
  btcReturns,
  symbol,
  name,
  rank,
  windowSize,
  days
) {
  const candles = await getHistory(symbol, days);
  const altReturns = toReturnsFromCandles(candles);
  const [aSynced, bSynced] = syncReturns(btcReturns, altReturns);
  const corr = rollingCorrelation(aSynced, bSynced, windowSize);
  return {
    symbol,
    name,
    market_cap_rank: rank,
    corr,
  };
}

// обмежуємо кількість днів (щоб не переломити ліміти)
function getClampedDays() {
  let days = Number(daysInput.value) || 1;
  if (days < 1) days = 1;
  const maxDays = 500 / 24; // для histohour з limit=500 [web:177]
  if (days > maxDays) days = maxDays;
  return days;
}

// ---------- завантаження топ‑10 ----------

async function loadTopMenu() {
  errorEl.textContent = "";
  currentRows = [];
  renderTable();

  const windowSize = Number(windowInput.value) || 30;
  const days = getClampedDays();

  reloadBtn.disabled = true;
  addBtn.disabled = true;
  statusEl.textContent = "Завантаження топ‑монет...";

  try {
    const top = await getTopCoins(11); // BTC + 10 альтів
    const btc = top.find((c) => c.symbol === "BTC");
    if (!btc) throw new Error("BTC не знайдено в топі");
    const alts = top.filter((c) => c.symbol !== "BTC").slice(0, 10);

    statusEl.textContent = "Завантаження історії BTC...";
    const btcCandles = await getHistory("BTC", days);
    const btcReturns = toReturnsFromCandles(btcCandles);

    for (const coin of alts) {
      statusEl.textContent = `Рахуємо ${coin.name}...`;
      try {
        const row = await computeCorrForSymbol(
          btcReturns,
          coin.symbol,
          coin.name,
          coin.market_cap_rank,
          windowSize,
          days
        );
        currentRows.push(row);
        renderTable();
      } catch (e) {
        console.error("Error for coin", coin.symbol, e);
      }
    }

    statusEl.textContent = "Готово";
  } catch (e) {
    console.error(e);
    errorEl.textContent = "Помилка: " + e.message;
    statusEl.textContent = "";
  } finally {
    reloadBtn.disabled = false;
    addBtn.disabled = false;
  }
}

// ---------- підвантаження збережених монет ----------

async function loadSavedCustomCoins() {
  if (!customIds.size) return;

  const windowSize = Number(windowInput.value) || 30;
  const days = getClampedDays();

  statusEl.textContent = "Завантажуємо збережені монети...";
  try {
    const btcCandles = await getHistory("BTC", days);
    const btcReturns = toReturnsFromCandles(btcCandles);

    for (const sym of customIds) {
      try {
        const url = `${BASE_URL}/top-mktcap?tsym=${VS}&limit=100`;
        const data = await fetchJson(url);

        if (data.Response === "Error") {
          throw new Error(data.Message || "CryptoCompare error");
        }
        const raw = data.Data;
        if (!Array.isArray(raw)) {
          console.error("top-mktcap unexpected:", data);
          throw new Error("Unexpected top-mktcap response format");
        }
        const list = raw
          .map((d, idx) => {
            const info = d.CoinInfo || {};
            return {
              symbol: info.Name,
              name: info.FullName || info.Name,
              market_cap_rank: idx + 1,
            };
          })
          .filter((c) => c.symbol);

        const coin = list.find((c) => c.symbol === sym);
        if (!coin) continue;

        const row = await computeCorrForSymbol(
          btcReturns,
          coin.symbol,
          coin.name,
          coin.market_cap_rank,
          windowSize,
          days
        );
        const existingIdx = currentRows.findIndex(
          (r) => r.symbol === row.symbol
        );
        if (existingIdx >= 0) currentRows[existingIdx] = row;
        else currentRows.push(row);
        renderTable();
      } catch (e) {
        console.error("Error loading saved coin", sym, e);
      }
    }
  } finally {
    statusEl.textContent = "";
  }
}

// ---------- додавання монети з UI ----------

async function addCustomCoin() {
  errorEl.textContent = "";
  const symRaw = customIdInput.value.trim();
  if (!symRaw) return;

  const symbol = symRaw.toUpperCase(); // символи великі
  const windowSize = Number(windowInput.value) || 30;
  const days = getClampedDays();

  reloadBtn.disabled = true;
  addBtn.disabled = true;
  statusEl.textContent = `Додаємо ${symbol}...`;

  try {
    const url = `${BASE_URL}/top-mktcap?tsym=${VS}&limit=100`;
    const data = await fetchJson(url);

    if (data.Response === "Error") {
      throw new Error(data.Message || "CryptoCompare error");
    }
    const raw = data.Data;
    if (!Array.isArray(raw)) {
      console.error("top-mktcap unexpected:", data);
      throw new Error("Unexpected top-mktcap response format");
    }
    const list = raw
      .map((d, idx) => {
        const info = d.CoinInfo || {};
        return {
          symbol: info.Name,
          name: info.FullName || info.Name,
          market_cap_rank: idx + 1,
        };
      })
      .filter((c) => c.symbol);

    const coin = list.find((c) => c.symbol === symbol);
    if (!coin) {
      throw new Error("Монету з таким символом не знайдено в топ‑списку");
    }

    const btcCandles = await getHistory("BTC", days);
    const btcReturns = toReturnsFromCandles(btcCandles);

    const row = await computeCorrForSymbol(
      btcReturns,
      coin.symbol,
      coin.name,
      coin.market_cap_rank,
      windowSize,
      days
    );

    const existingIdx =
      currentRows.findIndex((r) => r.symbol === row.symbol);
    if (existingIdx >= 0) {
      currentRows[existingIdx] = row;
    } else {
      currentRows.push(row);
      customIds.add(row.symbol);
      saveCustomIds();
    }
    renderTable();
    statusEl.textContent = "Готово";
  } catch (e) {
    console.error(e);
    errorEl.textContent = "Помилка: " + e.message;
    statusEl.textContent = "";
  } finally {
    reloadBtn.disabled = false;
    addBtn.disabled = false;
  }
}

// ---------- події та старт ----------

reloadBtn.addEventListener("click", () => {
  loadTopMenu().then(loadSavedCustomCoins);
});

addBtn.addEventListener("click", () => {
  addCustomCoin();
});

// перший запуск
loadTopMenu().then(loadSavedCustomCoins);
