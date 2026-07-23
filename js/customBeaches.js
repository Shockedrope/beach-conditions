// User-added beach IDs, persisted to localStorage. This is the self-serve
// answer to "how do I pick which beaches show up": since the API has no
// confirmed query to list all beaches (see README), the only way to add one
// is to know its numeric ID (found via DevTools on visitbeaches.org) and
// enter it here. Entries here are layered on top of the curated defaults in
// beaches.config.js, never replacing them.

const STORAGE_KEY = "bcrs.customBeachIds";

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeAll(ids) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // localStorage unavailable -- additions just won't persist across reloads.
  }
}

export function getCustomBeachIds() {
  return readAll();
}

export function addCustomBeachId(id) {
  const clean = String(id).trim();
  if (!clean || !/^\d+$/.test(clean)) {
    throw new Error("Beach ID must be a number (find it in DevTools on visitbeaches.org).");
  }
  const ids = readAll();
  if (!ids.includes(clean)) {
    ids.push(clean);
    writeAll(ids);
  }
  return clean;
}

export function removeCustomBeachId(id) {
  const clean = String(id);
  writeAll(readAll().filter((existing) => existing !== clean));
}

export function isCustomBeachId(id) {
  return readAll().includes(String(id));
}
