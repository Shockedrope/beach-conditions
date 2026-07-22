// Manually curated list of BCRS beach IDs to display on the dashboard.
//
// WHY THIS FILE EXISTS: the visitbeaches.org GraphQL API does not expose a
// known "list all beaches" query (see README.md, "Known limitations" section
// for what was tried). Until a listing query is confirmed, beaches must be
// added here by ID. `label` is only a fallback shown before the real API
// response arrives (or if a fetch fails) -- the authoritative name always
// comes from `beach.name` in the API response.
//
// To find more beach IDs: open visitbeaches.org, pick a beach on the map,
// and read the `id` variable out of the GetBeach request in DevTools ->
// Network -> the graphql request's payload.
export const BEACH_IDS = [
  { id: "25", label: "Beach #25" },
  { id: "42", label: "Beach #42" },
  { id: "67", label: "Beach #67" },
  { id: "15", label: "Beach #15" },
  { id: "26", label: "Beach #26" },
];
