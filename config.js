/* -----------------------------------------------------------------------------
 * Fleet Watch — settings
 *
 * Everything an office is likely to want to change lives in this one file.
 * The fleet itself is in fleet.js.
 * -------------------------------------------------------------------------- */

window.CONFIG = {

  /* --- Identity ---------------------------------------------------------- */

  // Shown top-left. The O is drawn as the power symbol from the logo when
  // `brandPowerMark` is on, matching the way the wordmark is set in the brand
  // book. Set `brandLogo` to an image path to use the real artwork instead —
  // a transparent PNG of the horizontal logotype, light or cyan on transparent,
  // sized around 600 px wide. That replaces the wordmark entirely.
  brand: 'ICON CONNECT',
  brandPowerMark: true,
  brandLogo: null,              // e.g. 'assets/logo-iconconnect.png'
  // Set beneath the wordmark, as the lockup does. Left as board ink rather than
  // the artwork's black, which would disappear against a dark ground.
  brandLocations: 'London  -  Monaco',
  subtitle: 'Fleet Watch',
  strapline: 'Technologies to enhance your life',

  /* --- Live AIS ---------------------------------------------------------- */

  // Free API key from https://aisstream.io (sign in with GitHub, generate a key).
  // Leave empty and the board runs in DEMO MODE with simulated movement, so you
  // can see exactly how it will look before you sign up for anything.
  //
  // WHILE THIS IS EMPTY NOTHING ON THE BOARD IS REAL. Every position, every
  // track, every figure is generated from the `demo` block in each fleet.js
  // record. The "Demo data" chip in the corner is the only thing saying so.
  //
  // Filling it in changes three things worth expecting:
  //   - Positions become real, keyed on MMSI. AIS broadcasts MMSI, never IMO,
  //     so a wrong MMSI silently tracks a stranger. The console now checks the
  //     name, IMO and size the transponder reports against each record and says
  //     so when they disagree.
  //   - Tracks start from empty. AISstream is a live stream with no history and
  //     no backfill: the board draws a trail from the moment it first hears a
  //     yacht, keeps it in this browser, and knows nothing of last week.
  //   - Gaps become normal. Terrestrial receivers reach perhaps 40 nm offshore,
  //     and a yacht crossing an ocean or running dark for the owner's privacy
  //     simply stops reporting. The board ages the last fix rather than
  //     pretending.
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
  // Change to wherever the screen actually is. The coordinates below are
  // central London, near enough for a distance measured in hundreds of miles;
  // put the building's own if you want the figure exact.
  office: {
    label: 'London office',
    lat: 51.5074,
    lon: -0.1278,
    timeZone: 'Europe/London'   // any IANA zone; used for the header clock
  },

  /* --- Rotation ---------------------------------------------------------- */

  // How long each view holds, in seconds. The chart gets the longest dwell
  // because it is the one people actually look up at.
  rotation: {
    enabled: true,
    chartSeconds: 75,
    spotlightSeconds: 24,       // per yacht
    statsSeconds: 40,
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

  // For the machine in reception. When locked, the D key stops working, so
  // whatever this build decided is what the screen shows — nobody passing it
  // can change the setting in either direction.
  //
  // The lock does not itself turn discretion on. With `discreetMode: false`
  // below, a locked board shows exact positions for the fleet and withholds
  // only the yachts marked `discreet: true` in fleet.js. That marking is the
  // protection that does not depend on anyone remembering, and it applies on
  // every screen, locked or not. Set `discreetMode: true` as well if the whole
  // board should be approximate.
  //
  // Set this true on the office display. Leave it false on the console, where
  // there is somebody present to work the toggle and to put it back.
  discreetLocked: false,

  /* --- Demo mode --------------------------------------------------------- */

  // Only used while aisStreamApiKey is empty. Time is compressed so movement is
  // actually visible: 30 means one real second of watching is thirty seconds of
  // simulated passage. Set to 1 for true real-time (and near-motionless) demo.
  demo: {
    timeScale: 30
  },

  /* --- Console ----------------------------------------------------------- */

  // Settings for console.html, the desk tool. The office display ignores these.
  // When a vessel broadcasts something her record has not got — her IMO, call
  // sign, length, beam, or whether she is motor or sail — take it. Only ever
  // fills a blank: a value somebody typed stays, and goes on being compared
  // with what she broadcasts, which is what catches a wrong MMSI.
  //
  // Turn it off and the console offers the same fields on a button instead.
  autoFillFromAis: true,

  /* --- Look -------------------------------------------------------------- */

  display: {
    // Slow drift keeps an OLED panel happy and stops the image feeling frozen.
    ambientMotion: true,
    // Light off the north-west of every landmass, shade off the south-east, and
    // a glow where the coast meets the water. Without it the chart is two flat
    // colours with a line between them.
    landShading: true,
    // Nudge the whole layout a few pixels every few minutes (burn-in insurance).
    pixelShift: true,
    pixelShiftMinutes: 7,
    // Draw the last N hours of each yacht's track behind it.
    trackHours: 24,
    // Dim the whole board outside office hours so it isn't glaring at night.
    // This is an evening dim, not a blackout: it should take the edge off a
    // bright panel in a dark room while leaving the board perfectly readable.
    nightDimming: true,
    nightDimFrom: 19,          // local hour
    nightDimTo: 7,
    nightDimOpacity: 0.78
  }
};
