// Data client for Mote Marine Laboratory's Beach Conditions Reporting System
// (BCRS) GraphQL API. Wraps the raw GraphQL call, caches responses briefly,
// and flattens the verbose nested response into a simple object a UI can
// render without knowing anything about the GraphQL schema.
//
// IMPORTANT CAVEATS (see README.md "Known limitations" for detail):
//  - The API only exposes the LAST THREE reports per beach, not full history.
//  - No confirmed "list all beaches" query exists yet. `discoverBeachListField`
//    below makes a best-effort attempt via introspection at runtime; if it
//    fails (introspection disabled, or no matching field), the caller must
//    fall back to the manually curated list in beaches.config.js.
//  - Field-name matching for weather/surf/water convenience values (see
//    FIELD_MATCHERS) is a best guess based on the category/parameter naming
//    scheme described by the reverse-engineered query, NOT verified against
//    live data. If real parameter names differ, only the convenience fields
//    (report.weather.*, report.surf.*, report.water.*) will come back empty
//    -- the raw `report.categories` structure is always populated and safe
//    to fall back to in the UI.

const ENDPOINT = "https://api.visitbeaches.org/graphql";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const GET_BEACH_QUERY = `
query GetBeach($id: ID!) {
  beach(id: $id) {
    ...Beach
    ...WithLastThreeReports
    __typename
  }
}

fragment Beach on Beach {
  id
  name
  website
  logo
  latitude
  longitude
  amenities { description link __typename }
  imageAttachments(orderBy: [{column: CREATED_AT, order: DESC}]) {
    originalUrl previewUrl thumbnailUrl __typename
  }
  city {
    name latitude longitude
    county { name latitude longitude state { name abbreviation latitude longitude __typename } __typename }
    state { name abbreviation latitude longitude __typename }
    __typename
  }
  location
  __typename
}

fragment WithLastThreeReports on Beach {
  lastThreeDaysOfReports {
    id
    user { id name email alert { id uuid email beaches { ...Beach __typename } __typename } __typename }
    createdAt
    latitude
    longitude
    beachReport {
      parameterCategory { id name icon description slug order __typename }
      reportParameters {
        parameter {
          id name icon prompt description type rangeMin rangeMax unit first
          parameterCategory { id name icon description slug order __typename }
          parameterValues { id name description value imagePath icon __typename }
          __typename
        }
        parameterValues { id name description value imagePath icon __typename }
        value
        __typename
      }
      __typename
    }
    __typename
  }
  __typename
}
`;

// Small, targeted introspection query -- just enough to look for a
// beach-listing field on the root Query type without pulling the whole schema.
const INTROSPECT_QUERY_FIELDS = `
{
  __schema {
    queryType {
      fields {
        name
        args { name type { name kind ofType { name kind } } }
      }
    }
  }
}
`;

const cache = new Map(); // beachId -> { data, expiresAt }

async function graphqlRequest(query, variables, operationName) {
  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operationName, query, variables }),
    });
  } catch (networkErr) {
    throw new Error(`Network error contacting BCRS API: ${networkErr.message}`);
  }

  if (!response.ok) {
    throw new Error(`BCRS API returned HTTP ${response.status}`);
  }

  const json = await response.json();
  if (json.errors && json.errors.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  return json.data;
}

/**
 * Best-effort attempt to find a beach-listing field on the root Query type
 * (e.g. `beaches`, `allBeaches`, `searchBeaches`). Returns the field name if
 * found, or null if introspection is disabled or nothing looks like a list.
 */
async function discoverBeachListField() {
  try {
    const data = await graphqlRequest(INTROSPECT_QUERY_FIELDS, {}, "IntrospectFields");
    const fields = data?.__schema?.queryType?.fields || [];
    const candidates = ["beaches", "allBeaches", "searchBeaches", "beachList", "beachesList"];
    const match = fields.find((f) => candidates.includes(f.name));
    return match ? match.name : null;
  } catch {
    return null; // introspection disabled, or blocked -- caller should fall back
  }
}

async function fetchBeachRaw(id, { skipCache = false } = {}) {
  const cached = cache.get(id);
  if (!skipCache && cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const data = await graphqlRequest(GET_BEACH_QUERY, { id }, "GetBeach");
  if (!data || !data.beach) {
    throw new Error(`No beach found for id ${id}`);
  }

  cache.set(id, { data: data.beach, expiresAt: Date.now() + CACHE_TTL_MS });
  return data.beach;
}

// --- Flattening -------------------------------------------------------

const FLAG_CLASS_BY_LABEL = {
  "double red": "double-red",
  red: "red",
  yellow: "yellow",
  green: "green",
  purple: "purple",
};

function flagClassFor(label) {
  if (!label) return "unknown";
  return FLAG_CLASS_BY_LABEL[label.trim().toLowerCase()] || "unknown";
}

function normalize(str) {
  return (str || "").toLowerCase();
}

// Reduces a category's reportParameters into a flat list of
// { name, description, value, unit } entries, preferring the selected
// parameterValues entry (dropdown-style answers) over the raw `value`.
function flattenParameters(reportParameters) {
  return (reportParameters || []).map((rp) => {
    const param = rp.parameter || {};
    const selected = (rp.parameterValues && rp.parameterValues[0]) || null;
    return {
      name: param.name || null,
      description: param.description || null,
      unit: param.unit || null,
      icon: (selected && selected.icon) || param.icon || null,
      value: selected ? selected.value : rp.value ?? null,
      label: selected ? selected.name : rp.value ?? null,
      valueDescription: selected ? selected.description : null,
    };
  });
}

// Best-effort lookup of a single parameter's flattened entry within a
// category, by matching parameter name/description against candidate
// substrings. Returns null if nothing matches (safe -- UI treats missing
// convenience fields as "no data").
function pickParam(categoryEntries, nameContainsAny) {
  if (!categoryEntries) return null;
  const found = categoryEntries.find((p) =>
    nameContainsAny.some((needle) => normalize(p.name).includes(needle) || normalize(p.description).includes(needle))
  );
  return found || null;
}

function flattenBeachReport(beach) {
  const reports = beach.lastThreeDaysOfReports || [];
  const sorted = [...reports].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const latest = sorted[0];

  const base = {
    beachId: beach.id,
    beachName: beach.name,
    location: beach.location || null,
    website: beach.website || null,
    logo: beach.logo || null,
    latitude: beach.latitude,
    longitude: beach.longitude,
    city: beach.city ? beach.city.name : null,
    state: beach.city && beach.city.state ? beach.city.state.abbreviation : null,
    images: (beach.imageAttachments || []).map((a) => a.thumbnailUrl || a.previewUrl || a.originalUrl),
    hasReport: Boolean(latest),
    reportedAt: latest ? latest.createdAt : null,
    categories: {},
    flag: { value: null, label: null, description: null, cssClass: "unknown" },
    weather: {},
    surf: {},
    water: {},
    driftAlgae: null,
    beachDebris: null,
    respiratoryIrritation: null,
    deadFish: null,
    jellyfish: null,
    crowds: null,
  };

  if (!latest) return base;

  // Group by category name -> flattened parameter list.
  const byCategory = {};
  for (const block of latest.beachReport || []) {
    const catName = block.parameterCategory?.name || "Unknown";
    byCategory[catName] = flattenParameters(block.reportParameters);
  }
  base.categories = byCategory;

  const flagEntry = (byCategory["Flag"] || [])[0];
  if (flagEntry) {
    base.flag = {
      value: flagEntry.value,
      label: flagEntry.label,
      description: flagEntry.valueDescription || flagEntry.description,
      cssClass: flagClassFor(flagEntry.label || flagEntry.value),
    };
  }

  const weather = byCategory["Weather"];
  base.weather = {
    uvIndex: pickParam(weather, ["uv"])?.label ?? null,
    airTemp: pickParam(weather, ["air temp", "temperature"])?.label ?? null,
    windSpeed: pickParam(weather, ["wind speed"])?.label ?? null,
    windDirection: pickParam(weather, ["wind direction"])?.label ?? null,
    summary: pickParam(weather, ["condition", "summary", "sky"])?.label ?? null,
    sunrise: pickParam(weather, ["sunrise"])?.label ?? null,
    sunset: pickParam(weather, ["sunset"])?.label ?? null,
  };

  const surf = byCategory["Surf Conditions"];
  base.surf = {
    height: pickParam(surf, ["height", "wave"])?.label ?? null,
    type: pickParam(surf, ["type"])?.label ?? null,
    intensity: pickParam(surf, ["intensity"])?.label ?? null,
    ripCurrents: pickParam(surf, ["rip current"])?.label ?? null,
    tides: pickParam(surf, ["tide"])?.label ?? null,
  };

  const water = byCategory["Water Conditions"];
  base.water = {
    color: pickParam(water, ["color"])?.label ?? null,
    tempF: pickParam(water, ["temp"])?.label ?? null,
  };

  // Single-focus categories: surface the first parameter's label/description.
  const simpleCategory = (name) => {
    const entry = (byCategory[name] || [])[0];
    if (!entry) return null;
    return { label: entry.label, description: entry.valueDescription || entry.description };
  };
  base.driftAlgae = simpleCategory("Drift Algae");
  base.beachDebris = simpleCategory("Beach Debris");
  base.respiratoryIrritation = simpleCategory("Respiratory Irritation");
  base.deadFish = simpleCategory("Dead Fish");
  base.jellyfish = simpleCategory("Jellyfish");
  base.crowds = simpleCategory("Crowds");

  return base;
}

/**
 * Fetches and flattens a single beach's report. Never throws for
 * data-not-found reasons -- returns a report object with an `error` field
 * instead, so a single bad beach ID doesn't break a batch fetch.
 */
export async function fetchBeach(id, opts) {
  try {
    const raw = await fetchBeachRaw(String(id), opts);
    return flattenBeachReport(raw);
  } catch (err) {
    return { beachId: String(id), error: err.message, hasReport: false };
  }
}

/**
 * Fetches multiple beaches with limited concurrency (the API has no
 * documented rate limits, but polling 150+ beaches at once is impolite).
 * Calls onProgress(completedCount, total) after each beach resolves.
 */
export async function fetchBeaches(ids, { concurrency = 6, onProgress, skipCache = false } = {}) {
  const results = new Array(ids.length);
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (nextIndex < ids.length) {
      const i = nextIndex++;
      results[i] = await fetchBeach(ids[i], { skipCache });
      completed++;
      if (onProgress) onProgress(completed, ids.length);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, ids.length) }, worker);
  await Promise.all(workers);
  return results;
}

export async function tryDiscoverBeachIds() {
  const fieldName = await discoverBeachListField();
  if (!fieldName) return null;

  try {
    const query = `{ ${fieldName} { id name latitude longitude } }`;
    const data = await graphqlRequest(query, {}, "DiscoverBeaches");
    const list = data?.[fieldName];
    if (!Array.isArray(list)) return null;
    return list.map((b) => ({ id: String(b.id), label: b.name }));
  } catch {
    return null;
  }
}

export function clearCache() {
  cache.clear();
}
