// ── Constants ─────────────────────────────────────────────────────────────────

const ALARM_NAME = "priceCheck";
const MAX_HISTORY = 60;

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-IN,en;q=0.9",
};

// Maps notificationId → product URL for click-through
const notifUrlMap = {};

// ── Storage helpers ───────────────────────────────────────────────────────────

async function getItems() {
  const { items = [] } = await chrome.storage.local.get("items");
  return items;
}

async function saveItems(items) {
  await chrome.storage.local.set({ items });
}

async function getHistory() {
  const { priceHistory = {} } = await chrome.storage.local.get("priceHistory");
  return priceHistory;
}

async function appendHistory(itemId, price) {
  const history = await getHistory();
  const key = String(itemId);
  const entries = history[key] || [];
  entries.unshift({ price, checkedAt: new Date().toISOString() });
  history[key] = entries.slice(0, MAX_HISTORY);
  await chrome.storage.local.set({ priceHistory: history });
}

async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  return {
    checkIntervalHours: 24,
    alertOnIncrease: true,
    alertOnDecrease: true,
    thresholdPct: 0,
    ...settings,
  };
}

// ── Scraper ───────────────────────────────────────────────────────────────────

function detectSite(url) {
  if (/amazon\.(in|com)/.test(url)) return "amazon";
  if (url.includes("flipkart.com")) return "flipkart";
  if (url.includes("reliancedigital.in")) return "reliancedigital";
  if (url.includes("croma.com")) return "croma";
  if (url.includes("myntra.com")) return "myntra";
  if (url.includes("meesho.com")) return "meesho";
  return "generic";
}

function parsePrice(str) {
  if (!str) return null;
  const n = parseFloat(String(str).replace(/[^\d.]/g, ""));
  return isNaN(n) || n <= 0 ? null : n;
}

function extractPrice(html, site) {
  // 1. JSON-LD schema.org Product (most reliable, works on many sites)
  for (const match of html.matchAll(
    /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  )) {
    try {
      let data = JSON.parse(match[1]);
      if (!Array.isArray(data)) data = [data];
      for (const d of data) {
        if (/Product/i.test(d["@type"] || "")) {
          const offers = Array.isArray(d.offers) ? d.offers[0] : d.offers || {};
          const p = parsePrice(offers.price ?? offers.lowPrice);
          if (p) return p;
        }
      }
    } catch (_) {}
  }

  // 2. Meta tags
  const metaPatterns = [
    /property="product:price:amount"[^>]*content="([\d,]+\.?\d*)"/i,
    /content="([\d,]+\.?\d*)"[^>]*property="product:price:amount"/i,
    /property="og:price:amount"[^>]*content="([\d,]+\.?\d*)"/i,
    /itemprop="price"[^>]*content="([\d,]+\.?\d*)"/i,
    /content="([\d,]+\.?\d*)"[^>]*itemprop="price"/i,
  ];
  for (const pat of metaPatterns) {
    const m = html.match(pat);
    if (m) { const p = parsePrice(m[1]); if (p) return p; }
  }

  // 3. Site-specific patterns
  const sitePatterns = {
    amazon: [
      /"priceAmount":"([\d.]+)"/,
      /id="priceblock_ourprice"[^>]*>[^₹\d]*([\d,]+\.?\d*)/,
      /class="a-offscreen"[^>]*>₹([\d,]+\.?\d*)/,
      /"price":{"value":([\d.]+)/,
    ],
    flipkart: [
      /class="_30jeq3[^"]*"[^>]*>₹([\d,]+)/,
      /class="Nx9bqj[^"]*"[^>]*>₹([\d,]+)/,
      /"finalPrice":([\d.]+)/,
    ],
    reliancedigital: [
      /class="pdp-price"[^>]*>[\s\S]{0,60}<strong[^>]*>([\d,]+)/i,
      /"sellingPrice":([\d.]+)/,
    ],
    croma: [
      /class="[^"]*pd-price[^"]*"[^>]*>([\d,]+)/,
      /"price":"([\d.]+)"/,
    ],
    meesho: [
      /"discountedPrice":([\d.]+)/,
      /"mrp":([\d.]+)/,
    ],
  };

  for (const pat of sitePatterns[site] || []) {
    const m = html.match(pat);
    if (m) { const p = parsePrice(m[1]); if (p) return p; }
  }

  // 4. Generic rupee fallback (grab the first prominent price)
  const rupeeMatches = [...html.matchAll(/₹\s*<[^>]*>\s*([\d,]+\.?\d*)|₹\s*([\d,]+\.?\d*)/g)];
  for (const m of rupeeMatches) {
    const p = parsePrice(m[1] || m[2]);
    if (p && p > 10) return p;
  }

  return null;
}

function extractName(html, site) {
  // og:title is consistent across all sites
  const og =
    html.match(/property="og:title"[^>]*content="([^"]+)"/i) ||
    html.match(/content="([^"]+)"[^>]*property="og:title"/i);
  if (og) return og[1].trim().slice(0, 120);

  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return title ? title[1].trim().slice(0, 120) : "";
}

async function fetchPrice(url) {
  const site = detectSite(url);
  try {
    const res = await fetch(url, { headers: FETCH_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const price = extractPrice(html, site);
    const name = extractName(html, site);
    return { price, name, site, success: price !== null };
  } catch (err) {
    return { price: null, name: "", site, success: false, error: err.message };
  }
}

// ── Notifications ─────────────────────────────────────────────────────────────

function notify(item, oldPrice, newPrice) {
  const isDown = newPrice < oldPrice;
  const pct = Math.abs(((newPrice - oldPrice) / oldPrice) * 100).toFixed(1);
  const fmt = (p) => "₹" + p.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  const notifId = `pt-${item.id}-${Date.now()}`;

  notifUrlMap[notifId] = item.url;

  chrome.notifications.create(notifId, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: `Price ${isDown ? "Drop 🎉" : "Increase"}: ${item.name.slice(0, 45)}`,
    message: `${isDown ? "↓" : "↑"} ${pct}%  ·  Now ${fmt(newPrice)}  (was ${fmt(oldPrice)})`,
    buttons: [{ title: "View Product" }],
    requireInteraction: isDown,
  });
}

chrome.notifications.onButtonClicked.addListener((notifId, btnIdx) => {
  if (btnIdx === 0 && notifUrlMap[notifId]) {
    chrome.tabs.create({ url: notifUrlMap[notifId] });
    chrome.notifications.clear(notifId);
    delete notifUrlMap[notifId];
  }
});

// ── Core check logic ──────────────────────────────────────────────────────────

async function checkItem(itemId) {
  const items = await getItems();
  const idx = items.findIndex((i) => i.id === itemId);
  if (idx === -1) return { success: false };

  const item = items[idx];
  const result = await fetchPrice(item.url);

  if (!result.success || result.price == null) {
    return { success: false, error: result.error };
  }

  const newPrice = result.price;
  const oldPrice = item.currentPrice;
  const now = new Date().toISOString();

  items[idx] = { ...item, currentPrice: newPrice, lastPrice: oldPrice ?? newPrice, lastChecked: now };
  await saveItems(items);
  await appendHistory(itemId, newPrice);

  // Notify if price changed beyond threshold
  if (oldPrice != null && oldPrice !== newPrice) {
    const settings = await getSettings();
    const changePct = Math.abs((newPrice - oldPrice) / oldPrice) * 100;
    if (changePct >= settings.thresholdPct) {
      if (newPrice < oldPrice && settings.alertOnDecrease) notify(item, oldPrice, newPrice);
      if (newPrice > oldPrice && settings.alertOnIncrease) notify(item, oldPrice, newPrice);
    }
  }

  return { success: true, price: newPrice, oldPrice };
}

async function checkAllItems() {
  const items = await getItems();
  const results = [];
  for (const item of items) {
    // Small delay between requests to avoid hammering sites
    await new Promise((r) => setTimeout(r, 1500));
    const r = await checkItem(item.id);
    results.push({ id: item.id, ...r });
  }
  return results;
}

// ── Alarm ─────────────────────────────────────────────────────────────────────

async function rescheduleAlarm(hours) {
  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: hours * 60 });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log("[PT] Alarm fired — checking all prices");
    await checkAllItems();
  }
});

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "ADD_ITEM": {
        const result = await fetchPrice(msg.url);
        const now = new Date().toISOString();
        const items = await getItems();
        const newItem = {
          id: Date.now(),
          url: msg.url,
          name: msg.name || result.name || msg.url.slice(0, 60),
          site: result.site || "generic",
          currentPrice: result.price ?? null,
          lastPrice: result.price ?? null,
          lastChecked: result.price ? now : null,
          createdAt: now,
        };
        items.unshift(newItem);
        await saveItems(items);
        if (result.price) await appendHistory(newItem.id, result.price);
        sendResponse({ success: true, item: newItem });
        break;
      }

      case "CHECK_ITEM": {
        const r = await checkItem(msg.id);
        sendResponse(r);
        break;
      }

      case "CHECK_ALL": {
        const results = await checkAllItems();
        sendResponse({ success: true, results });
        break;
      }

      case "EDIT_ITEM": {
        const items = await getItems();
        const idx = items.findIndex((i) => i.id === msg.id);
        if (idx !== -1) {
          items[idx] = { ...items[idx], name: msg.name, url: msg.url };
          await saveItems(items);
        }
        sendResponse({ success: idx !== -1 });
        break;
      }

      case "DELETE_ITEM": {
        let items = await getItems();
        items = items.filter((i) => i.id !== msg.id);
        await saveItems(items);
        // Clean up history
        const history = await getHistory();
        delete history[String(msg.id)];
        await chrome.storage.local.set({ priceHistory: history });
        sendResponse({ success: true });
        break;
      }

      case "GET_HISTORY": {
        const history = await getHistory();
        sendResponse(history[String(msg.id)] || []);
        break;
      }

      case "UPDATE_SETTINGS": {
        const current = await getSettings();
        const updated = { ...current, ...msg.settings };
        await chrome.storage.local.set({ settings: updated });
        await rescheduleAlarm(updated.checkIntervalHours);
        sendResponse({ success: true, settings: updated });
        break;
      }

      default:
        sendResponse({ success: false, error: "Unknown message type" });
    }
  })();
  return true; // keep channel open for async response
});

// ── Init ──────────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await rescheduleAlarm(settings.checkIntervalHours);
  console.log("[PT] Price Tracker installed — alarm set");
});

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});
