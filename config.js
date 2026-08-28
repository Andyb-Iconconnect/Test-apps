/* -----------------------------------------------------------------------------
 * Fleet Watch — settings
 *
 * Everything an office is likely to want to change lives in this one file.
 * The fleet itself is in fleet.js.
 * -------------------------------------------------------------------------- */

window.CONFIG = {

  /* --- Identity ---------------------------------------------------------- */

  // Shown top-left. Your company or fleet name.
  brand: 'Fleet Watch',
  subtitle: 'Live fleet positions',

  /* --- Live AIS ---------------------------------------------------------- */

  // Free API key from https://aisstream.io (sign in with GitHub, generate a key).
  // Leave empty and the board runs in DEMO MODE with simulated movement, so you
  // can see exactly how it will look before you sign up for anything.
  aisStreamApiKey: '',

  // AISstream delivers terrestrial AIS. Mid-ocean gaps are normal and expected:
  // a yacht crossing the Atlantic will simply go quiet for days. So will one
  // whose captain has switched the transponder off. Both are handled as
  // "last known position" rather than as errors.
  ais: {
    endpoint: 'wss://stream.aisstream.io/v0/stream',
    reconnectBaseMs: 2000,      // exponential backoff, capped below
    reconnectMaxMs: 60000,
    // A position older than this is drawn faded and labelled with its age.
    stalePositionMinutes: 90,
    // Older than this and the yacht is treated as dark: last known position
    // only, no speed or course shown.
    darkPositionHours: 12
  },

  /* --- Weather ----------------------------------------------------------- */

  // Open-Meteo needs no key and no account. Set enabled:false to run the board
  // with no outbound requests at all beyond AIS.
  weather: {
    enabled: true,
    refreshMinutes: 30,
    // Requests are staggered so eight yachts don't all fire at once.
    staggerMs: 1500
  },

  /* --- Units ------------------------------------------------------------- */

  units: {
    distance: 'nm',            // 'nm' | 'km'
    speed: 'kn',               // 'kn' | 'kmh'
    temperature: 'C',          // 'C' | 'F'
    windSpeed: 'kn'            // 'kn' | 'ms' | 'kmh'
  },

  // Office location — used for the "nearest to us" line and the header clock.
  // Defaults to Palma de Mallorca; change to wherever the screen actually is.
  office: {
    label: 'Palma office',
    lat: 39.5696,
    lon: 2.6502,
    timeZone: 'Europe/Madrid'   // any IANA zone; used for the header clock
  },

  /* --- Rotation ---------------------------------------------------------- */

  // How long each view holds, in seconds. The chart gets the longest dwell
  // because it is the one people actually look up at.
  rotation: {
    enabled: true,
    chartSeconds: 75,
    spotlightSeconds: 24,       // per yacht
    statsSeconds: 40,
    scheduleSeconds: 40,
    // Spotlight steps through every yacht before moving on. Set false to show
    // a single random yacht per rotation instead.
    spotlightAllYachts: true
  },

  /* --- Discretion -------------------------------------------------------- */

  // Superyacht owners pay for privacy. If this screen is visible to visitors,
  // reception, or through a window, consider turning this on: positions are
  // rounded to the nearest `discreetRoundingNm` and shown as a region rather
  // than a fix. Individual yachts can also be marked `discreet: true` in
  // fleet.js, which applies the same treatment regardless of this setting.
  // Press D on the keyboard to toggle it for everyone at any time.
  discreetMode: false,
  discreetRoundingNm: 60,

  /* --- Demo mode --------------------------------------------------------- */

  // Only used while aisStreamApiKey is empty. Time is compressed so movement is
  // actually visible: 30 means one real second of watching is thirty seconds of
  // simulated passage. Set to 1 for true real-time (and near-motionless) demo.
  demo: {
    timeScale: 30
  },

  /* --- Look -------------------------------------------------------------- */

  display: {
    // Slow drift keeps an OLED panel happy and stops the image feeling frozen.
    ambientMotion: true,
    // Nudge the whole layout a few pixels every few minutes (burn-in insurance).
    pixelShift: true,
    pixelShiftMinutes: 7,
    // Draw the last N hours of each yacht's track behind it.
    trackHours: 24,
    // Dim the whole board outside office hours so it isn't glaring at night.
    nightDimming: true,
    nightDimFrom: 19,          // local hour
    nightDimTo: 7,
    nightDimOpacity: 0.55
  }
};
