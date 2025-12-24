const VS = "usd";
const BASE_URL = "http://localhost:4000/api";

const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const tableBody = document.getElementById("tableBody");
const reloadBtn = document.getElementById("reloadBtn");
const windowInput = document.getElementById("window");
const daysInput = document.getElementById("days");
const customIdInput = document.getElementById("customId");
const addBtn = document.getElementById("addBtn");

let currentRows = []; // тримаємо тут об’єкти монет для рендеру

// ---------- утиліти ----------

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function getTopCoins(limit = 11) {
  const url = `${BASE_URL}/coins/markets?vs_currency=${VS}&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false`;
  return fetchJson(url);
}

async function getHistory(coinId, days) {
  const url = `${BASE_URL}/coins/${coinId}/market_chart?vs_currency=${VS}&days=${days}`;
  const data = await fetchJson(url);
  return data.prices;
}

function toReturns(priceArr) {
  const returns = [];
  for (let i = 1; i < priceArr.length; i++) {
    const [tPrev, pPrev] = priceArr[i - 1];
    const [t, p] = priceArr[i];
    if (!pPrev) continue;
    const r = (p - pPrev) / pPrev;
    returns.push({ t, r });
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
      <td><span class="badge">${row.symbol.toUpperCase()}</span></td>
      <td>${row.market_cap_rank ?? "-"}</td>
      <td class="${corrClass}">${corrFormatted}</td>
      <td><button data-id="${row.id}" class="remove-btn">Видалити</button></td>
    `;
    tableBody.appendChild(tr);
  });

  // навішуємо обробники на кнопки Видалити
  document.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      currentRows = currentRows.filter((r) => r.id !== id);
      renderTable();
    });
  });
}

// ---------- логіка завантаження ----------

async function computeCorrForCoin(btcReturns, coin, windowSize, days) {
  const altHistory = await getHistory(coin.id, days);
  const altReturns = toReturns(altHistory);
  const [aSynced, bSynced] = syncReturns(btcReturns, altReturns);
  const corr = rollingCorrelation(aSynced, bSynced, windowSize);
  return {
    id: coin.id,
    symbol: coin.symbol,
    name: coin.name,
    market_cap_rank: coin.market_cap_rank,
    corr,
  };
}

// завантажити топ‑10
async function loadTopMenu() {
  errorEl.textContent = "";
  currentRows = [];
  renderTable();

  const windowSize = Number(windowInput.value) || 30;
  const days = Number(daysInput.value) || 1;

  reloadBtn.disabled = true;
  addBtn.disabled = true;
  statusEl.textContent = "Завантаження топ‑монет...";

  try {
    const top = await getTopCoins(11);
    const btc = top.find((c) => c.id === "bitcoin");
    if (!btc) throw new Error("BTC не знайдено в топі");
    const alts = top.filter((c) => c.id !== "bitcoin").slice(0, 10);

    statusEl.textContent = "Завантаження історії BTC...";
    const btcHistory = await getHistory("bitcoin", days);
    const btcReturns = toReturns(btcHistory);

    for (const coin of alts) {
      statusEl.textContent = `Рахуємо ${coin.name}...`;
      try {
        const row = await computeCorrForCoin(btcReturns, coin, windowSize, days);
        currentRows.push(row);
        renderTable();
      } catch (e) {
        console.error("Error for coin", coin.id, e);
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

// додати кастомну монету по id
async function addCustomCoin() {
  errorEl.textContent = "";
  const id = customIdInput.value.trim();
  if (!id) return;

  const windowSize = Number(windowInput.value) || 30;
  const days = Number(daysInput.value) || 1;

  reloadBtn.disabled = true;
  addBtn.disabled = true;
  statusEl.textContent = `Додаємо ${id}...`;

  try {
    // інфо про монету (markets з per_page=1 через id) [web:130]
    const url = `${BASE_URL}/coins/markets?vs_currency=${VS}&ids=${encodeURIComponent(
      id
    )}&per_page=1&page=1&sparkline=false`;
    const arr = await fetchJson(url);
    if (!arr.length) {
      throw new Error("Монету з таким id не знайдено");
    }
    const coin = arr[0];

    // історія BTC (щоб не тягнути кожен раз – можна кешнути, але поки просто)
    const btcHistory = await getHistory("bitcoin", days);
    const btcReturns = toReturns(btcHistory);

    const row = await computeCorrForCoin(btcReturns, coin, windowSize, days);

    // якщо така вже є в таблиці — заміняємо
    const existingIdx = currentRows.findIndex((r) => r.id === row.id);
    if (existingIdx >= 0) {
      currentRows[existingIdx] = row;
    } else {
      currentRows.push(row);
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

// ---------- події ----------

reloadBtn.addEventListener("click", () => {
  loadTopMenu();
});

addBtn.addEventListener("click", () => {
  addCustomCoin();
});

// автозапуск
loadTopMenu();
