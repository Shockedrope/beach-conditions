// Favorite beaches, persisted to localStorage. No auth/backend needed.

const STORAGE_KEY = "bcrs.favoriteBeachIds";

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function writeAll(set) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // localStorage unavailable (private browsing, quota, etc) -- favorites
    // just won't persist across reloads; not worth surfacing an error for.
  }
}

export function isFavorite(beachId) {
  return readAll().has(String(beachId));
}

export function toggleFavorite(beachId) {
  const set = readAll();
  const id = String(beachId);
  if (set.has(id)) {
    set.delete(id);
  } else {
    set.add(id);
  }
  writeAll(set);
  return set.has(id);
}

export function getFavoriteIds() {
  return readAll();
}
