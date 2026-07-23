// Manually curated list of BCRS beach IDs to display on the dashboard by
// default. Users can add more at runtime via the "+ Add Beach" control in
// the UI (stored in localStorage, see js/customBeaches.js) without editing
// this file -- that's the only way to add a beach right now, since the API
// has no confirmed "list all beaches" query (see README.md).
//
// Ordered roughly north -> south along the barrier islands from Lido Key
// down to Boca Grande / Gasparilla Island, per request. IDs were only
// confirmed for the southern half of that stretch (via real API responses);
// the northern beaches are still missing real IDs -- see the TODO block
// below for how to fill them in.
//
// To find a beach ID: open visitbeaches.org, click a beach on the map, and
// read the `id` variable out of the GetBeach request in DevTools -> Network.
export const BEACH_IDS = [
  // --- TODO: missing IDs for the northern part of the corridor ---
  // Add these once you have real IDs (use the "+ Add Beach" button in the
  // UI, or add entries here in the same { id, label } shape):
  //   Lido Key (Lido Beach / South Lido Park)
  //   Siesta Key (Siesta Beach / Turtle Beach)
  //   Casey Key / Nokomis Beach
  //   Venice Beach (North Jetty / Brohard Paw Park)
  //   Manasota Beach

  // --- Confirmed via live API response ---
  { id: "42", label: "Englewood Beach" },
  { id: "67", label: "Stump Pass Beach State Park" },
  { id: "25", label: "Gasparilla Island State Park (South Lighthouse)" },
  { id: "26", label: "Gasparilla Island Lighthouse" },
];

// Just south of Boca Grande Pass -- outside the requested Lido-to-Boca-Grande
// range, so left out of the default list. Add it back (here or via the "+
// Add Beach" UI) if you want it included: { id: "15", label: "Captiva" }
