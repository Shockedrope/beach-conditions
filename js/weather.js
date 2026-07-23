// Live current-conditions weather client, using the National Weather
// Service API (api.weather.gov). Chosen over a commercial provider because
// it needs no API key -- this is a static, client-side-only site, so any
// key embedded in the JS would be public anyway. NWS is US-only, which is
// fine since every beach here is in FL/SC/AL.
//
// This is deliberately separate from the BCRS "Weather" category in
// api.js: that reflects conditions at the time a volunteer submitted a
// report (which, per the reason this file exists, can be days or weeks
// stale). This module fetches what the weather actually is right now.
//
// Flow per beach: /points/{lat},{lon} -> nearest observation station ->
// that station's latest observation. If the station has no recent/complete
// observation, falls back to the hourly forecast's current period.
//
// Note: NWS asks non-browser clients to set a descriptive User-Agent
// header. Browsers don't allow scripts to set that header (it's
// browser-controlled), so that guidance doesn't apply here.

const GRID_CACHE = new Map(); // "lat,lon" -> { stationId, forecastHourlyUrl } (session-long; a beach's location never changes)
const CONDITIONS_CACHE = new Map(); // stationId -> { data, expiresAt }
const CONDITIONS_TTL_MS = 15 * 60 * 1000; // 15 minutes

async function nwsGet(url) {
  const response = await fetch(url, { headers: { Accept: "application/geo+json" } });
  if (!response.ok) {
    throw new Error(`weather.gov returned HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

function gridKey(lat, lon) {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

function cToF(celsius) {
  return typeof celsius === "number" ? Math.round((celsius * 9) / 5 + 32) : null;
}

function kmhToMph(kmh) {
  return typeof kmh === "number" ? Math.round(kmh / 1.60934) : null;
}

const COMPASS_POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

function degreesToCompass(deg) {
  if (typeof deg !== "number" || Number.isNaN(deg)) return null;
  return COMPASS_POINTS[Math.round(deg / 22.5) % 16];
}

// Rough keyword match from a plain-English forecast description to an
// emoji, for a compact glanceable icon without pulling NWS's icon images.
function conditionsEmoji(text) {
  const t = (text || "").toLowerCase();
  if (/thunder|storm/.test(t)) return "⛈️";
  if (/snow|sleet|ice/.test(t)) return "❄️";
  if (/rain|shower|drizzle/.test(t)) return "🌧️";
  if (/fog|mist|haze/.test(t)) return "🌫️";
  if (/wind/.test(t)) return "💨";
  if (/(mostly |partly )?cloudy|overcast/.test(t)) return "⛅";
  if (/clear|sunny|fair/.test(t)) return "☀️";
  return "🌤️";
}

async function resolveGrid(lat, lon) {
  const key = gridKey(lat, lon);
  if (GRID_CACHE.has(key)) return GRID_CACHE.get(key);

  const point = await nwsGet(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
  const props = point.properties || {};
  const forecastHourlyUrl = props.forecastHourly || null;

  let stationId = null;
  if (props.observationStations) {
    const stations = await nwsGet(props.observationStations);
    stationId = stations.features?.[0]?.properties?.stationIdentifier || null;
  }

  const grid = { stationId, forecastHourlyUrl };
  GRID_CACHE.set(key, grid);
  return grid;
}

async function fetchFromStation(stationId) {
  const obs = await nwsGet(`https://api.weather.gov/stations/${stationId}/observations/latest`);
  const p = obs.properties || {};
  const tempF = cToF(p.temperature?.value);
  if (tempF === null) return null; // incomplete observation -- let caller fall back

  return {
    tempF,
    conditions: p.textDescription || null,
    windSpeedMph: kmhToMph(p.windSpeed?.value),
    windDirection: degreesToCompass(p.windDirection?.value),
    humidity: typeof p.relativeHumidity?.value === "number" ? Math.round(p.relativeHumidity.value) : null,
    observedAt: p.timestamp || null,
    source: "observation",
    stationId,
  };
}

async function fetchFromHourlyForecast(forecastHourlyUrl) {
  const forecast = await nwsGet(forecastHourlyUrl);
  const period = forecast.properties?.periods?.[0];
  if (!period) throw new Error("No forecast periods returned");

  const windMatch = /(\d+)/.exec(period.windSpeed || "");
  return {
    tempF: typeof period.temperature === "number" ? period.temperature : null,
    conditions: period.shortForecast || null,
    windSpeedMph: windMatch ? Number(windMatch[1]) : null,
    windDirection: period.windDirection || null,
    humidity: typeof period.relativeHumidity?.value === "number" ? Math.round(period.relativeHumidity.value) : null,
    observedAt: period.startTime || null,
    source: "forecast",
    stationId: null,
  };
}

/**
 * Fetches current conditions for a single lat/lon. Never throws --
 * returns { error } instead, since weather is a supplementary
 * enhancement and one beach's failure shouldn't affect the others.
 */
export async function fetchCurrentWeather(lat, lon, { skipCache = false } = {}) {
  if (typeof lat !== "number" || typeof lon !== "number") {
    return { error: "No location for this beach" };
  }

  try {
    const { stationId, forecastHourlyUrl } = await resolveGrid(lat, lon);

    const cacheKey = stationId || `hourly:${forecastHourlyUrl}`;
    if (!skipCache) {
      const cached = CONDITIONS_CACHE.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.data;
    }

    let data = null;
    if (stationId) {
      try {
        data = await fetchFromStation(stationId);
      } catch {
        data = null; // fall through to forecast
      }
    }
    if (!data && forecastHourlyUrl) {
      data = await fetchFromHourlyForecast(forecastHourlyUrl);
    }
    if (!data) throw new Error("No current conditions available");

    data.emoji = conditionsEmoji(data.conditions);
    CONDITIONS_CACHE.set(cacheKey, { data, expiresAt: Date.now() + CONDITIONS_TTL_MS });
    return data;
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Fetches current weather for many beaches with limited concurrency,
 * calling onEach(beachId, weatherResult) as soon as each one resolves so
 * the UI can update progressively rather than waiting for the whole batch.
 */
export async function fetchWeatherForBeaches(beaches, { concurrency = 4, onEach, skipCache = false } = {}) {
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < beaches.length) {
      const beach = beaches[nextIndex++];
      const weather = await fetchCurrentWeather(beach.latitude, beach.longitude, { skipCache });
      if (onEach) onEach(beach.beachId, weather);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, beaches.length) }, worker);
  await Promise.all(workers);
}
