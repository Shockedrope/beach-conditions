# Beach Conditions Dashboard

An unofficial, read-only dashboard for [Mote Marine Laboratory's Beach
Conditions Reporting System (BCRS)](https://visitbeaches.org) — built
because the official site is an interactive map that's slow to scan across
multiple beaches at a glance.

This is a static, no-build, no-backend site: plain HTML/CSS/JS. The API has
open CORS and needs no auth, so the browser talks to it directly — there's
nothing to deploy or run server-side.

## Running it

Because the app fetches from `https://api.visitbeaches.org`, some browsers
restrict `fetch()` from a page opened directly via `file://`. Serve the
folder over a trivial local static server instead:

```bash
python3 -m http.server 8000
# or: npx serve .
```

Then open `http://localhost:8000`.

## How it works

- `js/api.js` — the data client. POSTs the reverse-engineered `GetBeach`
  GraphQL query, flattens the deeply nested response into a simple object
  per beach (`{ beachId, beachName, flag, weather, surf, water,
  respiratoryIrritation, deadFish, ... }`), and caches each beach's response
  in memory for 5 minutes so re-renders/polling don't hammer the API.
- `js/beaches.config.js` — the manually curated default list of beach IDs
  (see "Known limitations" below for why this is manual).
- `js/customBeaches.js` — user-added beach IDs, localStorage-backed, layered
  on top of the defaults. This is how you add beaches beyond the curated
  list — see "Selecting which beaches show up" below.
- `js/favorites.js` — localStorage-backed favorite beaches, no account
  needed.
- `js/app.js` — renders the card grid, search/filter, favorites toggle,
  add-beach panel, loading skeletons, and error banners.

## Selecting which beaches show up

There's no confirmed "list/search all beaches" API query (see limitation #1
below), so beach selection works in two layers:

1. **Defaults** — `js/beaches.config.js`, currently the confirmed southern
   half of the Lido Key → Boca Grande corridor (Englewood Beach, Stump Pass
   Beach State Park, and both Gasparilla Island entries). Edit this file
   directly to change the shipped defaults.
2. **Your own additions** — click **+ Add Beach** in the top bar and enter a
   numeric beach ID. Find one by opening visitbeaches.org, clicking a beach
   on the map, and reading the `id` out of the `GetBeach` request in
   DevTools → Network. Additions are saved to `localStorage` (not the repo),
   layered on top of the defaults, and each gets a ✕ button on its card to
   remove it again.

The northern part of the Lido → Boca Grande corridor (Lido Key, Siesta Key,
Nokomis, Venice, Manasota Key) doesn't have confirmed IDs yet — add them via
+ Add Beach once you've looked them up, or contribute them back to
`beaches.config.js`.

## Known limitations

**This was built without live access to the BCRS API from the dev
environment** (the sandbox's network policy blocked outbound requests to
`api.visitbeaches.org`), so the schema-discovery steps below were
implemented defensively in code rather than verified against real
responses. Once you run this in a browser that *can* reach the API, a few
things should be double-checked:

1. **No confirmed "list all beaches" query.** `js/api.js` runs a small
   introspection query at startup (`discoverBeachListField`) looking for a
   root query field named `beaches`, `allBeaches`, `searchBeaches`, etc. The
   deployed dashboard has only ever shown exactly the beaches configured in
   `js/beaches.config.js`, which strongly suggests introspection isn't
   finding a listing field on the live API (either it's disabled, or none of
   those names exist) — but this hasn't been confirmed by directly
   inspecting the `IntrospectFields` network request/response. Either way,
   the practical result is the same: beach selection is manual, via
   `beaches.config.js` + **+ Add Beach** (see "Selecting which beaches show
   up" above).

2. **Only the last 3 reports per beach are available.** There is no known
   date-range/history query. The dashboard only ever shows the most recent
   report; historical trends aren't possible with this API as currently
   understood.

3. **Convenience field mapping (weather/surf/water) is a best guess.** The
   flattener groups raw parameters by category (`Flag`, `Weather`, `Surf
   Conditions`, `Water Conditions`, etc. — from the field descriptions given
   during reverse-engineering) and then fuzzy-matches parameter
   name/description text (e.g. "uv", "air temp", "wind speed") to populate
   `report.weather.uvIndex` and friends. **This has not been verified
   against a real response.** If the real API's parameter names don't match
   the substrings in `FIELD_MATCHERS`-equivalent logic (see `pickParam`
   calls in `js/api.js`), those specific convenience fields will just come
   back `null` and won't render — but the full raw data is always available
   in `report.categories` per beach, so nothing is silently lost, only
   possibly not surfaced in the pretty view yet. Adjust the matcher
   substrings in `flattenBeachReport()` once you can see real field names.

4. **Red tide "notable" heuristic is unverified.** The dashboard tries to
   highlight respiratory irritation / dead fish / water color chips only
   when they don't look like "None observed" — see `isNotable()` in
   `js/app.js`. The exact wording BCRS uses for "nothing to report" hasn't
   been confirmed, so this may over- or under-trigger until checked against
   live data.

If you can get a real response from the API (even a single one, saved to
a file), share it and the matching logic above can be tightened up
significantly.

## Features

- Card grid color-coded by flag status (Green / Yellow / Red / Double Red /
  Purple), most prominent visual element per card
- Red-tide-relevant indicators (respiratory irritation, dead fish, water
  color) surfaced as chips when present
- Collapsible sections per card for weather, surf, and water detail
- Clear "reported X ago" timestamp (reports are not real-time); if a
  report isn't from today, the flag color grays out and a ⚠️ appears next
  to the timestamp, so a stale "Green" doesn't read as a current all-clear
- Search/filter by beach or city name
- Favorite beaches (localStorage, no account)
- Add/remove beaches by ID at runtime (localStorage, no account)
- Loading skeletons and per-beach + global error states
- Mobile-responsive layout

## Attribution

All beach condition data is sourced from Mote Marine Laboratory's Beach
Conditions Reporting System via `visitbeaches.org`. This project is not
affiliated with or endorsed by Mote Marine Laboratory.
