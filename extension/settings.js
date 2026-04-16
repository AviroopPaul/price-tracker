const $ = (id) => document.getElementById(id);

async function loadSettings() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  const s = {
    checkIntervalHours: 24,
    alertOnDecrease: true,
    alertOnIncrease: true,
    thresholdPct: 0,
    ...settings,
  };

  const sel = $("check-interval");
  // Select closest matching option
  const vals = Array.from(sel.options).map((o) => Number(o.value));
  const closest = vals.reduce((a, b) =>
    Math.abs(b - s.checkIntervalHours) < Math.abs(a - s.checkIntervalHours) ? b : a
  );
  sel.value = String(closest);

  $("alert-decrease").checked = s.alertOnDecrease;
  $("alert-increase").checked = s.alertOnIncrease;
  $("threshold").value = s.thresholdPct;

  // Show item count
  const { items = [] } = await chrome.storage.local.get("items");
  $("stat-items").textContent = `${items.length} item${items.length !== 1 ? "s" : ""} tracked`;

  // Show next alarm time
  const alarm = await chrome.alarms.get("priceCheck");
  if (alarm) {
    const next = new Date(alarm.scheduledTime);
    $("next-check").textContent = `Next check: ${next.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} · ${next.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
  } else {
    $("next-check").textContent = "No alarm scheduled";
  }
}

$("btn-save").addEventListener("click", async () => {
  const btn = $("btn-save");
  btn.disabled = true;
  btn.textContent = "Saving…";

  const settings = {
    checkIntervalHours: parseInt($("check-interval").value, 10),
    alertOnDecrease: $("alert-decrease").checked,
    alertOnIncrease: $("alert-increase").checked,
    thresholdPct: parseFloat($("threshold").value) || 0,
  };

  const res = await chrome.runtime.sendMessage({ type: "UPDATE_SETTINGS", settings });

  btn.disabled = false;
  btn.textContent = "Save Settings";

  if (res?.success) {
    showMsg("Settings saved!", "success");
    await loadSettings(); // refresh next-check time
  } else {
    showMsg("Failed to save settings.", "error");
  }
});

$("btn-check-now").addEventListener("click", async () => {
  const btn = $("btn-check-now");
  const svg = btn.querySelector("svg");
  btn.disabled = true;
  svg.classList.add("spin");

  const res = await chrome.runtime.sendMessage({ type: "CHECK_ALL" });

  btn.disabled = false;
  svg.classList.remove("spin");

  const ok = (res?.results || []).filter((r) => r.success).length;
  showMsg(`Checked ${res?.results?.length ?? 0} item(s) — ${ok} updated.`, "success");
  await loadSettings();
});

$("btn-clear-data").addEventListener("click", async () => {
  if (!confirm("Remove all tracked items and price history? This cannot be undone.")) return;
  await chrome.storage.local.set({ items: [], priceHistory: {} });
  showMsg("All data cleared.", "success");
  await loadSettings();
});

function showMsg(text, type) {
  const el = $("save-msg");
  el.textContent = text;
  el.className = `save-msg ${type}`;
  el.classList.remove("hidden");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add("hidden"), 4000);
}

loadSettings();
