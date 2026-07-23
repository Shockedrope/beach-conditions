import { fetchBeaches, tryDiscoverBeachIds } from "./api.js";
import { BEACH_IDS } from "./beaches.config.js";
import { isFavorite, toggleFavorite, getFavoriteIds } from "./favorites.js";
import { getCustomBeachIds, addCustomBeachId, removeCustomBeachId, isCustomBeachId } from "./customBeaches.js";
import { fetchWeatherForBeaches } from "./weather.js";

const grid = document.getElementById("grid");
const searchInput = document.getElementById("search-input");
const favoritesToggle = document.getElementById("favorites-toggle");
const refreshBtn = document.getElementById("refresh-btn");
const statusBanner = document.getElementById("status-banner");
const addBeachToggle = document.getElementById("add-beach-toggle");
const addBeachPanel = document.getElementById("add-beach-panel");
const addBeachForm = document.getElementById("add-beach-form");
const addBeachInput = document.getElementById("add-beach-input");
const addBeachError = document.getElementById("add-beach-error");

let reports = []; // flattened beach reports, current in-memory state
let searchTerm = "";
let favoritesOnly = false;
let weatherByBeachId = {}; // live NWS current-conditions, keyed by beachId; persists across re-renders

function showBanner(message) {
  statusBanner.textContent = message;
  statusBanner.classList.add("visible");
}
function hideBanner() {
  statusBanner.classList.remove("visible");
}

function renderSkeletons(count) {
  grid.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const el = document.createElement("div");
    el.className = "skeleton";
    grid.appendChild(el);
  }
}

// Labels that read as "nothing to worry about" -- used to decide whether a
// red-tide-relevant category is worth surfacing as a prominent chip. This is
// a heuristic (see api.js caveats about unverified field naming): if a
// category's actual wording doesn't match common "none/clear" phrasing, the
// chip will show even when conditions are normal. Worth revisiting once real
// response data confirms the exact strings the API uses.
function isNotable(entry) {
  if (!entry || !entry.label) return false;
  return !/^(none|no |not observed|clear|absent|n\/a)/i.test(entry.label.trim());
}

function formatTimestamp(iso) {
  if (!iso) return "No recent report";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const diffMs = now - d;
  const diffHrs = diffMs / 36e5;
  const rel = diffHrs < 1 ? "less than an hour ago" : diffHrs < 48 ? `${Math.round(diffHrs)}h ago` : d.toLocaleDateString();
  return `Reported ${rel} (${d.toLocaleString()})`;
}

// Whether a report's date matches today's calendar date in the viewer's
// local timezone (not just "within the last 24h" -- a report from 11pm
// yesterday reads as stale even if it's only a few hours old).
function isReportToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

// Calendar-day timestamp (time-of-day stripped) for grouping reports by
// date rather than exact instant -- two beaches reported an hour apart on
// the same day should land in the same "day bucket" for sorting purposes.
// Missing/invalid dates sort last (oldest).
function dateOnlyValue(iso) {
  if (!iso) return -Infinity;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return -Infinity;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Sort by most recent report date first, then north-to-south (higher
// latitude first) within the same date. Reports with no date/location
// (errors, no-report beaches) sort to the bottom.
function sortReports(list) {
  return [...list].sort((a, b) => {
    const dateDiff = dateOnlyValue(b.reportedAt) - dateOnlyValue(a.reportedAt);
    if (dateDiff !== 0) return dateDiff;
    const latA = typeof a.latitude === "number" ? a.latitude : -Infinity;
    const latB = typeof b.latitude === "number" ? b.latitude : -Infinity;
    return latB - latA;
  });
}

function formatWeatherTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Renders just the dynamic part of the live-weather strip (loading /
// unavailable / actual conditions), so it can be regenerated in place both
// on initial card render and later via a targeted DOM update as each
// beach's weather resolves, without touching the rest of the card.
function weatherContentHtml(beachId) {
  const w = weatherByBeachId[beachId];
  if (!w) {
    return `<span class="weather-loading">Fetching current weather…</span>`;
  }
  if (w.error) {
    return `<span class="weather-unavailable">Current weather unavailable</span>`;
  }

  const parts = [];
  if (typeof w.tempF === "number") parts.push(`${w.tempF}°F`);
  if (w.conditions) parts.push(escapeHtml(w.conditions));
  const windBits = [w.windSpeedMph ? `${w.windSpeedMph} mph` : null, w.windDirection].filter(Boolean).join(" ");
  if (windBits) parts.push(`Wind ${escapeHtml(windBits)}`);

  const asOf = w.observedAt ? formatWeatherTime(w.observedAt) : null;
  return `
    <span class="weather-emoji">${w.emoji || "🌤️"}</span>
    <span class="weather-text">${parts.join(" · ") || "No data"}</span>
    ${asOf ? `<span class="weather-asof">as of ${asOf}</span>` : ""}
  `;
}

// Updates one card's weather strip in place (if that card is currently
// rendered -- it may be filtered out, which is fine, we just skip it).
function updateWeatherSlot(beachId) {
  const el = grid.querySelector(`.weather-content[data-weather-for="${CSS.escape(String(beachId))}"]`);
  if (el) el.innerHTML = weatherContentHtml(beachId);
}

function kv(label, value) {
  if (value === null || value === undefined || value === "") return "";
  return `<div class="k">${label}</div><div class="v">${escapeHtml(String(value))}</div>`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function googleMapsUrl(lat, lon) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}

function renderCard(report) {
  const card = document.createElement("div");

  if (report.error) {
    const removableOnError = isCustomBeachId(report.beachId);
    card.className = "card flag-unknown";
    card.innerHTML = `
      <div class="card-header">
        <div class="card-title"><h2>${escapeHtml(report.beachId)}</h2><div class="sub">Beach ID ${escapeHtml(report.beachId)}</div></div>
        ${removableOnError ? `<button class="remove-btn" title="Remove this beach" data-action="remove">✕</button>` : ""}
      </div>
      <div class="card-error">Couldn't load this beach: ${escapeHtml(report.error)}</div>
    `;
    const removeBtn = card.querySelector('[data-action="remove"]');
    if (removeBtn) {
      removeBtn.addEventListener("click", () => {
        removeCustomBeachId(report.beachId);
        reports = reports.filter((r) => r.beachId !== report.beachId);
        applyFilters();
      });
    }
    return card;
  }

  const stale = report.hasReport && !isReportToday(report.reportedAt);

  card.className = `card flag-${report.flag.cssClass}${stale ? " stale" : ""}`;
  card.dataset.beachId = report.beachId;

  const fav = isFavorite(report.beachId);
  const removable = isCustomBeachId(report.beachId);

  const redTideChips = [];
  if (isNotable(report.respiratoryIrritation)) {
    redTideChips.push(`Respiratory irritation: ${escapeHtml(report.respiratoryIrritation.label)}`);
  }
  if (isNotable(report.deadFish)) {
    redTideChips.push(`Dead fish: ${escapeHtml(report.deadFish.label)}`);
  }
  if (report.water.color && isNotable({ label: report.water.color })) {
    redTideChips.push(`Water color: ${escapeHtml(report.water.color)}`);
  }

  const weatherKv = [
    kv("UV Index", report.weather.uvIndex),
    kv("Air Temp", report.weather.airTemp),
    kv("Wind", [report.weather.windSpeed, report.weather.windDirection].filter(Boolean).join(" ")),
    kv("Conditions", report.weather.summary),
    kv("Sunrise", report.weather.sunrise),
    kv("Sunset", report.weather.sunset),
  ].filter(Boolean).join("");

  const surfKv = [
    kv("Wave Height", report.surf.height),
    kv("Type", report.surf.type),
    kv("Intensity", report.surf.intensity),
    kv("Rip Currents", report.surf.ripCurrents),
    kv("Tides", report.surf.tides),
  ].filter(Boolean).join("");

  const waterKv = [
    kv("Color", report.water.color),
    kv("Temp", report.water.tempF),
  ].filter(Boolean).join("");

  const otherEntries = [
    ["Drift Algae", report.driftAlgae],
    ["Beach Debris", report.beachDebris],
    ["Jellyfish", report.jellyfish],
    ["Crowds", report.crowds],
  ].filter(([, v]) => v && v.label);
  const otherKv = otherEntries.map(([label, v]) => kv(label, v.label)).join("");

  card.innerHTML = `
    <div class="card-header">
      <div class="card-title">
        <h2>${
          typeof report.latitude === "number" && typeof report.longitude === "number"
            ? `<a class="beach-name-link" href="${googleMapsUrl(report.latitude, report.longitude)}" target="_blank" rel="noopener noreferrer" title="Open in Google Maps">${escapeHtml(report.beachName || `Beach #${report.beachId}`)}</a>`
            : escapeHtml(report.beachName || `Beach #${report.beachId}`)
        }</h2>
        <div class="sub">${escapeHtml([report.city, report.state].filter(Boolean).join(", "))}</div>
      </div>
      <div class="card-actions">
        <button class="fav-btn ${fav ? "active" : ""}" title="Toggle favorite" data-action="fav">${fav ? "★" : "☆"}</button>
        ${removable ? `<button class="remove-btn" title="Remove this beach" data-action="remove">✕</button>` : ""}
      </div>
    </div>
    <div class="weather-live">
      <span class="weather-label">Now</span>
      <span class="weather-content" data-weather-for="${escapeHtml(String(report.beachId))}">${weatherContentHtml(report.beachId)}</span>
    </div>
    <div class="flag-badge flag-${report.flag.cssClass}${stale ? " stale" : ""}">${escapeHtml(report.flag.label || "No flag data")}</div>
    ${report.flag.description ? `<div class="flag-description">${escapeHtml(report.flag.description)}</div>` : ""}
    ${redTideChips.length ? `<div class="redtide-row">${redTideChips.map((c) => `<span class="redtide-chip">${c}</span>`).join("")}</div>` : ""}
    <div class="timestamp">${stale ? `<span class="stale-warning" title="This report is not from today -- conditions may have changed">⚠️</span>` : ""}${escapeHtml(formatTimestamp(report.reportedAt))}</div>
    <div class="card-body">
      ${!report.hasReport ? '<div class="no-data">No reports in the last 3 days.</div>' : ""}
      ${weatherKv ? `<details class="section"><summary>Weather</summary><div class="kv-grid">${weatherKv}</div></details>` : ""}
      ${surfKv ? `<details class="section"><summary>Surf</summary><div class="kv-grid">${surfKv}</div></details>` : ""}
      ${waterKv ? `<details class="section"><summary>Water</summary><div class="kv-grid">${waterKv}</div></details>` : ""}
      ${otherKv ? `<details class="section"><summary>Other Observations</summary><div class="kv-grid">${otherKv}</div></details>` : ""}
    </div>
  `;

  card.querySelector('[data-action="fav"]').addEventListener("click", () => {
    const nowFav = toggleFavorite(report.beachId);
    card.querySelector('[data-action="fav"]').textContent = nowFav ? "★" : "☆";
    card.querySelector('[data-action="fav"]').classList.toggle("active", nowFav);
    if (favoritesOnly) applyFilters();
  });

  const removeBtn = card.querySelector('[data-action="remove"]');
  if (removeBtn) {
    removeBtn.addEventListener("click", () => {
      removeCustomBeachId(report.beachId);
      reports = reports.filter((r) => r.beachId !== report.beachId);
      applyFilters();
    });
  }

  return card;
}

function matchesSearch(report, term) {
  if (!term) return true;
  const haystack = `${report.beachName || ""} ${report.city || ""} ${report.state || ""}`.toLowerCase();
  return haystack.includes(term);
}

function applyFilters() {
  const favIds = getFavoriteIds();
  const term = searchTerm.trim().toLowerCase();

  const filtered = reports.filter((r) => {
    if (favoritesOnly && !favIds.has(String(r.beachId))) return false;
    if (!matchesSearch(r, term)) return false;
    return true;
  });

  grid.innerHTML = "";
  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = favoritesOnly
      ? "No favorite beaches match your search yet. Star a beach to save it here."
      : "No beaches match your search.";
    grid.appendChild(empty);
    return;
  }

  for (const report of filtered) {
    grid.appendChild(renderCard(report));
  }
}

async function loadAll({ skipCache = false } = {}) {
  hideBanner();

  let idEntries = BEACH_IDS;
  const discovered = await tryDiscoverBeachIds();
  if (discovered && discovered.length) {
    idEntries = discovered;
  }

  // User-added beach IDs are always layered on top, even if a beach-listing
  // query was discovered -- they're an explicit ask, not a fallback.
  const existingIds = new Set(idEntries.map((b) => b.id));
  const customIds = getCustomBeachIds().filter((id) => !existingIds.has(id));
  idEntries = [...idEntries, ...customIds.map((id) => ({ id, label: `Beach #${id}` }))];

  renderSkeletons(idEntries.length);

  const ids = idEntries.map((b) => b.id);
  const fetched = await fetchBeaches(ids, {
    concurrency: 6,
    skipCache,
    onProgress: () => {}, // could wire up a progress bar; skeletons are enough for now
  });
  reports = sortReports(fetched);

  const failedCount = reports.filter((r) => r.error).length;
  if (failedCount === reports.length && reports.length > 0) {
    const fileHint = window.location.protocol === "file:"
      ? " This page was opened directly from a file:// URL, which some browsers block from making cross-origin requests -- try serving this folder with a local static server instead (see README)."
      : " The BCRS API may be temporarily down, or your network/browser may be blocking the request.";
    showBanner(`Couldn't load any beach data.${fileHint}`);
  } else if (failedCount > 0) {
    showBanner(`${failedCount} of ${reports.length} beaches failed to load. Try Refresh to retry.`);
  }

  applyFilters();
  loadWeather(reports, { skipCache });
}

// Fetches live current-conditions weather for each beach and patches it
// into already-rendered cards as each one resolves. Intentionally not
// awaited by callers -- this runs in the background so it never delays the
// initial (report-based) render, and doesn't disturb scroll position or
// any open <details> sections the way a full grid rebuild would.
async function loadWeather(list, { skipCache = false } = {}) {
  const targets = list.filter((r) => !r.error && typeof r.latitude === "number" && typeof r.longitude === "number");
  await fetchWeatherForBeaches(targets, {
    concurrency: 4,
    skipCache,
    onEach: (beachId, weather) => {
      weatherByBeachId[beachId] = weather;
      updateWeatherSlot(beachId);
    },
  });
}

let searchDebounce;
searchInput.addEventListener("input", (e) => {
  clearTimeout(searchDebounce);
  const value = e.target.value;
  searchDebounce = setTimeout(() => {
    searchTerm = value;
    applyFilters();
  }, 150);
});

favoritesToggle.addEventListener("click", () => {
  favoritesOnly = !favoritesOnly;
  favoritesToggle.classList.toggle("active", favoritesOnly);
  applyFilters();
});

refreshBtn.addEventListener("click", () => {
  loadAll({ skipCache: true });
});

addBeachToggle.addEventListener("click", () => {
  const nowVisible = addBeachPanel.classList.toggle("visible");
  addBeachToggle.classList.toggle("active", nowVisible);
  if (nowVisible) addBeachInput.focus();
});

addBeachForm.addEventListener("submit", (e) => {
  e.preventDefault();
  addBeachError.classList.remove("visible");
  try {
    addCustomBeachId(addBeachInput.value);
    addBeachInput.value = "";
    loadAll();
  } catch (err) {
    addBeachError.textContent = err.message;
    addBeachError.classList.add("visible");
  }
});

loadAll();
