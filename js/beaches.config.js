// Manually curated list of BCRS beach IDs to display on the dashboard by
// default. Users can add more at runtime via the "+ Add Beach" control in
// the UI (stored in localStorage, see js/customBeaches.js) without editing
// this file -- that's the only way to add a beach right now, since the API
// has no confirmed "list all beaches" query (see README.md).
//
// Full Lido Key -> Boca Grande (Gasparilla Island) corridor, listed north to
// south. This list order is just for readability/initial fetch scheduling --
// actual display order is computed at render time (most recent report date
// first, then north-to-south by real latitude), so it doesn't need to be
// kept in sync with the app's sort logic.
//
// To find a beach ID: open visitbeaches.org, click a beach on the map, and
// read the `id` variable out of the GetBeach request in DevTools -> Network.
export const BEACH_IDS = [
  { id: "4", label: "Lido Key" },
  { id: "96", label: "Ted Sperling Park" },
  { id: "2", label: "Siesta Beach" },
  { id: "60", label: "Turtle Beach" },
  { id: "5", label: "Nokomis Beach" },
  { id: "1", label: "North Jetty" },
  { id: "6", label: "Venice Beach" },
  { id: "132", label: "Sharky's" },
  { id: "40", label: "Caspersen Beach" },
  { id: "3", label: "Manasota Beach" },
  { id: "42", label: "Englewood Beach" },
  { id: "67", label: "Stump Pass Beach State Park" },
  { id: "26", label: "Gasparilla Island Lighthouse" },
  { id: "25", label: "Gasparilla Island State Park (South Lighthouse)" },
];

// Just south of Boca Grande Pass -- a separate barrier island chain, not
// part of the Lido-to-Boca-Grande corridor above. Add it via the "+ Add
// Beach" UI if you want it included: beach ID 15 (Captiva).
