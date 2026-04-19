const $ = (id) => document.getElementById(id);

let items = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

function msg(type, payload = {}) {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage({ type, ...payload }, resolve)
  );
}

function fmtPrice(p) {
  if (p == null) return null;
  return "₹" + Number(p).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function fmtTime(iso) {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function pctChange(cur, prev) {
  if (cur == null || prev == null || prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}

const SITE_LABELS = { amazon: "Amazon", flipkart: "Flipkart", reliancedigital: "Reliance", croma: "Croma", myntra: "Myntra", meesho: "Meesho", generic: "Web" };
const SITE_BADGE  = { amazon: "badge-amazon", flipkart: "badge-flipkart", reliancedigital: "badge-reliancedigital", croma: "badge-croma", myntra: "badge-myntra", meesho: "badge-meesho", generic: "badge-generic" };

function showStatus(text, type) {
  const el = $("add-status");
  el.textContent = text;
  el.className = `add-status ${type}`;
  el.classList.remove("hidden");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add("hidden"), 4000);
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderRows() {
  const tbody = $("items-body");
  tbody.innerHTML = "";

  const drops = items.filter(
    (i) => i.currentPrice != null && i.lastPrice != null && i.currentPrice < i.lastPrice
  ).length;

  $("stat-total").textContent = `${items.length} item${items.length !== 1 ? "s" : ""}`;

  if (drops > 0) {
    $("stat-drops").textContent = `↓ ${drops} cheaper`;
    $("stat-drops").classList.remove("hidden");
  } else {
    $("stat-drops").classList.add("hidden");
  }

  if (!items.length) {
    $("empty-state").classList.remove("hidden");
    $("items-table").classList.add("hidden");
    return;
  }

  $("empty-state").classList.add("hidden");
  $("items-table").classList.remove("hidden");

  for (const item of items) {
    const pct = pctChange(item.currentPrice, item.lastPrice);
    let changeBadge = `<span class="change-badge change-none">—</span>`;
    if (pct !== null && Math.abs(pct) >= 0.01) {
      changeBadge = pct < 0
        ? `<span class="change-badge change-down">↓ ${Math.abs(pct).toFixed(1)}%</span>`
        : `<span class="change-badge change-up">↑ ${pct.toFixed(1)}%</span>`;
    }

    const tr = document.createElement("tr");
    tr.dataset.id = item.id;
    tr.innerHTML = `
      <td>
        <div class="cell-name">
          <span class="item-name" title="${item.name}">${item.name}</span>
          <div class="item-meta">
            <span class="site-badge ${SITE_BADGE[item.site] || "badge-generic"}">${SITE_LABELS[item.site] || "Web"}</span>
            <span class="item-time">${fmtTime(item.lastChecked)}</span>
          </div>
        </div>
      </td>
      <td class="cell-price">
        ${item.currentPrice != null
          ? `<span class="price-value">${fmtPrice(item.currentPrice)}</span>`
          : `<span class="price-na">N/A</span>`}
      </td>
      <td class="cell-change">${changeBadge}</td>
      <td class="cell-actions">
        <div class="row-actions">
          <button class="row-btn edit-btn" data-id="${item.id}" title="Edit name / URL">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="row-btn refresh-btn" data-id="${item.id}" title="Refresh price">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
            </svg>
          </button>
          <button class="row-btn history-btn" data-id="${item.id}" data-name="${item.name}" title="Price history">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </button>
          <button class="row-btn delete delete-btn" data-id="${item.id}" title="Remove">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
              <path d="M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
            </svg>
          </button>
        </div>
      </td>`;

    tr.querySelector(".item-name").addEventListener("click", () =>
      chrome.tabs.create({ url: item.url })
    );
    tbody.appendChild(tr);
  }

  // Update last-checked time in stats bar
  const latest = items.map((i) => i.lastChecked).filter(Boolean).sort().pop();
  $("last-updated").textContent = latest ? `Updated ${fmtTime(latest)}` : "";
}

// ── Load ──────────────────────────────────────────────────────────────────────

async function loadItems() {
  const { items: stored = [] } = await chrome.storage.local.get("items");
  items = stored;
  renderRows();
}

// Live updates: re-render whenever storage changes (background writes new prices)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.items) {
    items = changes.items.newValue || [];
    renderRows();
  }
});

// ── Add item ──────────────────────────────────────────────────────────────────

$("btn-add").addEventListener("click", async () => {
  const url = $("inp-url").value.trim();
  const name = $("inp-name").value.trim();
  if (!url) { showStatus("Please enter a product URL.", "error"); return; }

  const btn = $("btn-add");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Fetching…`;

  const res = await msg("ADD_ITEM", { url, name: name || null });

  if (res?.success) {
    $("inp-url").value = "";
    $("inp-name").value = "";
    const priceStr = res.item.currentPrice ? ` · ${fmtPrice(res.item.currentPrice)}` : " · price not found";
    showStatus(`Added${priceStr}`, "success");
    // Storage change listener will re-render automatically
  } else {
    showStatus("Failed to add item.", "error");
  }

  btn.disabled = false;
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Item`;
});

$("inp-url").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btn-add").click(); });

// ── Event delegation (refresh / history / delete) ─────────────────────────────

$("items-body").addEventListener("click", async (e) => {
  const refreshBtn = e.target.closest(".refresh-btn");
  const deleteBtn  = e.target.closest(".delete-btn");
  const histBtn    = e.target.closest(".history-btn");

  const editBtn = e.target.closest(".edit-btn");

  if (editBtn) {
    const id = Number(editBtn.dataset.id);
    const item = items.find((i) => i.id === id);
    if (item) openEditModal(item);
  }

  if (refreshBtn) {
    const id = Number(refreshBtn.dataset.id);
    refreshBtn.classList.add("spin");
    refreshBtn.disabled = true;
    const r = await msg("CHECK_ITEM", { id });
    refreshBtn.classList.remove("spin");
    refreshBtn.disabled = false;
    if (!r?.success) showStatus("Could not fetch price — site may have blocked the request.", "error");
  }

  if (deleteBtn) {
    const id = Number(deleteBtn.dataset.id);
    await msg("DELETE_ITEM", { id });
    // Storage listener will re-render
  }

  if (histBtn) {
    const id = Number(histBtn.dataset.id);
    await openHistoryModal(id, histBtn.dataset.name);
  }
});

// ── Refresh all ───────────────────────────────────────────────────────────────

$("btn-refresh-all").addEventListener("click", async () => {
  const btn = $("btn-refresh-all");
  btn.querySelector("svg").style.animation = "spin .8s linear infinite";
  btn.disabled = true;
  const r = await msg("CHECK_ALL");
  btn.querySelector("svg").style.animation = "";
  btn.disabled = false;
  const ok = (r?.results || []).filter((x) => x.success).length;
  showStatus(`Refreshed ${r?.results?.length ?? 0} items — ${ok} updated.`, "success");
});

// ── Edit modal ────────────────────────────────────────────────────────────────

function openEditModal(item) {
  $("edit-id").value = item.id;
  $("edit-name").value = item.name;
  $("edit-url").value = item.url;
  $("edit-overlay").classList.remove("hidden");
  $("edit-name").focus();
  $("edit-name").select();
}

$("edit-save").addEventListener("click", async () => {
  const id = Number($("edit-id").value);
  const name = $("edit-name").value.trim();
  const url = $("edit-url").value.trim();
  if (!name) { $("edit-name").focus(); return; }
  if (!url)  { $("edit-url").focus();  return; }

  $("edit-save").disabled = true;
  $("edit-save").textContent = "Saving…";

  await msg("EDIT_ITEM", { id, name, url });

  $("edit-save").disabled = false;
  $("edit-save").textContent = "Save Changes";
  $("edit-overlay").classList.add("hidden");
  // Storage listener will re-render automatically
});

$("edit-cancel").addEventListener("click", () => $("edit-overlay").classList.add("hidden"));
$("edit-close").addEventListener("click",  () => $("edit-overlay").classList.add("hidden"));
$("edit-overlay").addEventListener("click", (e) => {
  if (e.target === $("edit-overlay")) $("edit-overlay").classList.add("hidden");
});
$("edit-name").addEventListener("keydown", (e) => { if (e.key === "Enter") $("edit-save").click(); });

// ── History modal ─────────────────────────────────────────────────────────────

async function openHistoryModal(itemId, name) {
  $("modal-title").textContent = `${name} — History`;
  $("modal-body").innerHTML = `<p style="color:var(--gray-400);font-size:12px;padding:8px 0">Loading…</p>`;
  $("modal-overlay").classList.remove("hidden");

  const history = await msg("GET_HISTORY", { id: itemId });

  if (!history?.length) {
    $("modal-body").innerHTML = `<p style="color:var(--gray-400);font-size:12px;padding:8px 0">No history recorded yet.</p>`;
    return;
  }

  let rows = "";
  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    const prev = history[i + 1];
    let changeHtml = "—";
    if (prev) {
      const diff = h.price - prev.price;
      const pct = (diff / prev.price) * 100;
      if (Math.abs(pct) >= 0.01) {
        const cls = diff < 0 ? "hist-down" : "hist-up";
        changeHtml = `<span class="${cls}">${diff < 0 ? "↓" : "↑"} ${Math.abs(pct).toFixed(1)}%</span>`;
      }
    }
    const d = new Date(h.checkedAt);
    rows += `<tr>
      <td>${d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}, ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</td>
      <td class="hist-price">${fmtPrice(h.price)}</td>
      <td>${changeHtml}</td>
    </tr>`;
  }

  $("modal-body").innerHTML = `
    <table class="history-table">
      <thead><tr><th>Date &amp; Time</th><th>Price</th><th>Change</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

$("modal-close").addEventListener("click", () => $("modal-overlay").classList.add("hidden"));
$("modal-overlay").addEventListener("click", (e) => {
  if (e.target === $("modal-overlay")) $("modal-overlay").classList.add("hidden");
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadItems();
