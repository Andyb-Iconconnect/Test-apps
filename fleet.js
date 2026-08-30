/* -----------------------------------------------------------------------------
 * THE FLEET — this is the file you swap.
 *
 * Every yacht below is INVENTED. The IMO and MMSI numbers are deliberately
 * sequential placeholders (9900001+, 3190000xx) so they cannot collide with a
 * real vessel. Replace them with your own boats and the board becomes yours.
 *
 * The only field live tracking actually needs is `mmsi` — that is the identity
 * AIS broadcasts on. IMO is carried in the slower static message and is useful
 * as your own reference, but you cannot subscribe to a feed by IMO alone.
 * Everything else is display detail you control.
 *
 * FIELDS
 *   id            unique short slug, used internally
 *   name          without the M/Y/S/Y prefix
 *   prefix        'M/Y' or 'S/Y'
 *   mmsi          9-digit Maritime Mobile Service Identity  ← required for live AIS
 *   imo           7-digit IMO number
 *   callSign, flag, flagCode
 *   loa, beam     metres
 *   grossTonnage
 *   builder, yearBuilt, lastRefit, classSociety
 *   photo         path to an image, e.g. 'assets/photos/aurelia.jpg'. Left null,
 *                 a drawn side profile stands in for her — derived from length,
 *                 tonnage and rig, so it is a plausible yacht of her size but
 *                 not a likeness. Drop a photograph in and it takes over.
 *   discreet      true → never show an exact position for this yacht, regardless
 *                 of the global discreetMode setting
 *   service       your own operational data — the part no tracking site can show
 *   systems       what we have installed, by service line, with the date. Drives
 *                 both the aftersales "what am I supporting" view and the sales
 *                 "which boats are due an upgrade conversation" list
 *   contacts      who to reach aboard. Shown in the console only, never on the
 *                 office display
 *   demo          starting state for DEMO MODE only; ignored once live AIS is on
 * -------------------------------------------------------------------------- */

window.FLEET = [
   {
    id: 'cloudbreak-5800',
    name: 'Cloudbreak',
    prefix: 'M/Y',
    mmsi: 319095800,
    imo: 1012763,
    callSign: null,
    flag: 'Cayman Islands',
    flagCode: null,
    loa: 72.25, beam: null, grossTonnage: null,
    builder: 'Abeking & Rasmussen',
    yearBuilt: 2016, lastRefit: null,
    classSociety: null,
    photo: null,
    discreet: false,
    service: {
      nextEvent: null,
      nextEventDate: null,
      engineer: null,
      openJobs: 0,
      urgentJobs: 0,
      partsOnOrder: [],
      yardPeriod: null
    },
    systems: [
      { line: 'AV',       product: null, installed: null },
      { line: 'IT',       product: null, installed: null },
      { line: 'Security', product: null, installed: null }
    ],
    contacts: [],
    // DEMO MODE ONLY, and invented. Without this block she has no simulated
    // position, so she sits in the list as "no signal" and never reaches the
    // chart. Once CONFIG.aisStreamApiKey is set, live AIS on her MMSI replaces
    // all of it and this is ignored.
    demo: {
      status: 'underway',
      speed: 11.5,
      route: [[7.42, 43.73], [5.37, 43.18], [3.05, 42.30], [2.63, 39.57]],
      destination: 'PALMA',
      etaHours: 26
    }
  }
];
