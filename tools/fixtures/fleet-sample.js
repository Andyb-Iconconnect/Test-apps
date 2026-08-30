/* -----------------------------------------------------------------------------
 * A sample fleet, for the tests and as a worked example.
 *
 * These eight yachts are INVENTED, and their IMO/MMSI numbers sit in ranges
 * that cannot collide with a real vessel. They were fleet.js's original
 * contents; they live here now so that swapping fleet.js for your own boats
 * cannot break the test suite. Nothing in the apps loads this file.
 *
 * It is also the fullest example of a record there is — every optional field
 * populated, a sailing yacht, a discreet yacht, and each shape of `demo` block.
 * Worth copying from when you add a vessel by hand.
 * -------------------------------------------------------------------------- */

window.FLEET_SAMPLE = [
  {
    id: 'aurelia',
    name: 'Aurelia',
    prefix: 'M/Y',
    mmsi: 319000001,
    imo: 9900019,
    callSign: 'ZGAA1',
    flag: 'Cayman Islands',
    flagCode: 'KY',
    loa: 62.4, beam: 11.2, grossTonnage: 1180,
    builder: 'Placeholder Yard',
    yearBuilt: 2019, lastRefit: 2024,
    classSociety: "Lloyd's Register",
    photo: null,
    discreet: false,
    service: {
      nextEvent: 'Annual class survey',
      nextEventDate: '2026-10-14',
      engineer: 'A. Placeholder',
      openJobs: 3,
      urgentJobs: 0,
      partsOnOrder: [
        { item: 'Stabiliser seal kit', eta: '2026-09-04', port: 'Palma' }
      ],
      yardPeriod: null
    },
    // What we have installed, along our own service lines. This is the table
    // that answers both "what am I supporting on this boat" and "which boats
    // are due a conversation" — the console flags anything past its age.
    systems: [
      { line: 'AV',     product: 'Placeholder control & entertainment', installed: '2024-06' },
      { line: 'IT',     product: 'Placeholder network & Wi-Fi core', installed: '2024-06' },
      { line: 'Security', product: 'Placeholder CCTV & access control', installed: '2019-04' }
    ],
    contacts: [
      { role: 'Captain', name: 'Placeholder Name', email: 'captain@example.invalid' },
      { role: 'Chief Engineer', name: 'Placeholder Name', email: 'engineer@example.invalid' }
    ],
    demo: {
      status: 'underway',
      speed: 12.4,
      destination: 'IBIZA',
      etaHours: 5,
      // Palma → Ibiza, roughly
      route: [[2.65, 39.55], [2.35, 39.42], [1.90, 39.20], [1.44, 38.98], [1.26, 38.91]]
    }
  },

  {
    id: 'northern-light',
    name: 'Northern Light',
    prefix: 'M/Y',
    mmsi: 319000002,
    imo: 9900021,
    callSign: 'ZGAA2',
    flag: 'Cayman Islands',
    flagCode: 'KY',
    loa: 48.0, beam: 9.1, grossTonnage: 495,
    builder: 'Placeholder Yard',
    yearBuilt: 2021, lastRefit: null,
    classSociety: 'RINA',
    photo: null,
    discreet: false,
    service: {
      nextEvent: 'Warranty inspection',
      nextEventDate: '2026-09-08',
      engineer: 'B. Placeholder',
      openJobs: 1,
      urgentJobs: 0,
      partsOnOrder: [],
      yardPeriod: null
    },
    // What we have installed, along our own service lines. This is the table
    // that answers both "what am I supporting on this boat" and "which boats
    // are due a conversation" — the console flags anything past its age.
    systems: [
      { line: 'AV',     product: 'Placeholder control & entertainment', installed: '2021-03' },
      { line: 'IT',     product: 'Placeholder network & Wi-Fi core', installed: '2021-03' },
      { line: 'Security', product: 'Placeholder CCTV & access control', installed: '2021-03' }
    ],
    contacts: [
      { role: 'Captain', name: 'Placeholder Name', email: 'captain@example.invalid' },
      { role: 'Chief Engineer', name: 'Placeholder Name', email: 'engineer@example.invalid' }
    ],
    demo: {
      status: 'anchored',
      speed: 0.2,
      destination: 'FORMENTERA',
      etaHours: 0,
      position: [1.44, 38.68]        // off Formentera
    }
  },

  {
    id: 'sea-ember',
    name: 'Sea Ember',
    prefix: 'M/Y',
    mmsi: 319000003,
    imo: 9900033,
    callSign: 'ZGAA3',
    flag: 'Cayman Islands',
    flagCode: 'KY',
    loa: 75.2, beam: 12.8, grossTonnage: 1980,
    builder: 'Placeholder Yard',
    yearBuilt: 2016, lastRefit: 2023,
    classSociety: "Lloyd's Register",
    photo: null,
    discreet: false,
    service: {
      nextEvent: 'Five-yearly special survey',
      nextEventDate: '2026-11-30',
      engineer: 'C. Placeholder',
      openJobs: 6,
      urgentJobs: 1,
      partsOnOrder: [
        { item: 'Main engine injector set', eta: '2026-09-12', port: 'Antigua' },
        { item: 'Tender davit ram', eta: '2026-09-19', port: 'Antigua' }
      ],
      yardPeriod: null
    },
    // Demonstrates the state you WILL see in real life: a yacht mid-ocean with
    // no terrestrial AIS coverage. The board shows its last known fix and ages it.
    // What we have installed, along our own service lines. This is the table
    // that answers both "what am I supporting on this boat" and "which boats
    // are due a conversation" — the console flags anything past its age.
    systems: [
      { line: 'AV',     product: 'Placeholder control & entertainment', installed: '2023-09' },
      { line: 'IT',     product: 'Placeholder network & Wi-Fi core', installed: '2016-02' },
      { line: 'Security', product: 'Placeholder CCTV & access control', installed: '2023-09' }
    ],
    contacts: [
      { role: 'Captain', name: 'Placeholder Name', email: 'captain@example.invalid' },
      { role: 'Chief Engineer', name: 'Placeholder Name', email: 'engineer@example.invalid' }
    ],
    demo: {
      status: 'dark',
      speed: 15.1,
      destination: 'ANTIGUA',
      etaHours: 96,
      position: [-38.4, 28.9],       // mid-Atlantic
      lastSeenHoursAgo: 62,
      course: 262
    }
  },

  {
    id: 'corvina',
    name: 'Corvina',
    prefix: 'M/Y',
    mmsi: 319000004,
    imo: 9900045,
    callSign: 'ZGAA4',
    flag: 'Malta',
    flagCode: 'MT',
    loa: 38.6, beam: 8.0, grossTonnage: 299,
    builder: 'Placeholder Yard',
    yearBuilt: 2022, lastRefit: null,
    classSociety: 'Bureau Veritas',
    photo: null,
    discreet: false,
    service: {
      nextEvent: 'Tender service',
      nextEventDate: '2026-09-02',
      engineer: 'A. Placeholder',
      openJobs: 2,
      urgentJobs: 0,
      partsOnOrder: [],
      yardPeriod: null
    },
    // What we have installed, along our own service lines. This is the table
    // that answers both "what am I supporting on this boat" and "which boats
    // are due a conversation" — the console flags anything past its age.
    systems: [
      { line: 'AV',     product: 'Placeholder control & entertainment', installed: '2022-05' },
      { line: 'IT',     product: 'Placeholder network & Wi-Fi core', installed: '2022-05' },
      { line: 'Security', product: null, installed: null }
    ],
    contacts: [
      { role: 'Captain', name: 'Placeholder Name', email: 'captain@example.invalid' },
      { role: 'Chief Engineer', name: 'Placeholder Name', email: 'engineer@example.invalid' }
    ],
    demo: {
      status: 'moored',
      speed: 0,
      destination: 'MONACO',
      etaHours: 0,
      position: [7.4256, 43.7350]    // Port Hercule, Monaco
    }
  },

  {
    id: 'halcyon-blue',
    name: 'Halcyon Blue',
    prefix: 'M/Y',
    mmsi: 249000005,
    imo: 9900057,
    callSign: 'ZGAA5',
    flag: 'Malta',
    flagCode: 'MT',
    loa: 55.0, beam: 10.4, grossTonnage: 812,
    builder: 'Placeholder Yard',
    yearBuilt: 2018, lastRefit: 2025,
    classSociety: 'RINA',
    photo: null,
    // Marked discreet: this one is never shown at an exact position, even when
    // the rest of the board is in full-detail mode.
    discreet: true,
    service: {
      nextEvent: 'Interim survey',
      nextEventDate: '2027-01-22',
      engineer: 'D. Placeholder',
      openJobs: 0,
      urgentJobs: 0,
      partsOnOrder: [],
      yardPeriod: null
    },
    // What we have installed, along our own service lines. This is the table
    // that answers both "what am I supporting on this boat" and "which boats
    // are due a conversation" — the console flags anything past its age.
    systems: [
      { line: 'AV',     product: 'Placeholder control & entertainment', installed: '2025-04' },
      { line: 'IT',     product: 'Placeholder network & Wi-Fi core', installed: '2025-04' },
      { line: 'Security', product: 'Placeholder CCTV & access control', installed: '2018-07' }
    ],
    contacts: [
      { role: 'Captain', name: 'Placeholder Name', email: 'captain@example.invalid' },
      { role: 'Chief Engineer', name: 'Placeholder Name', email: 'engineer@example.invalid' }
    ],
    demo: {
      status: 'underway',
      speed: 10.8,
      destination: 'CAPRI',
      etaHours: 3,
      route: [[14.60, 40.63], [14.48, 40.60], [14.32, 40.57], [14.24, 40.55]]  // Amalfi → Capri
    }
  },

  {
    id: 'silver-meridian',
    name: 'Silver Meridian',
    prefix: 'M/Y',
    mmsi: 538000006,
    imo: 9900069,
    callSign: 'ZGAA6',
    flag: 'Marshall Islands',
    flagCode: 'MH',
    loa: 88.0, beam: 14.2, grossTonnage: 2890,
    builder: 'Placeholder Yard',
    yearBuilt: 2014, lastRefit: 2026,
    classSociety: 'DNV',
    photo: null,
    discreet: false,
    service: {
      nextEvent: 'Refit — sea trials',
      nextEventDate: '2026-10-03',
      engineer: 'E. Placeholder',
      openJobs: 24,
      urgentJobs: 2,
      partsOnOrder: [
        { item: 'Bow thruster bearing', eta: '2026-09-01', port: 'Rotterdam' }
      ],
      yardPeriod: { yard: 'Placeholder Refit Yard', from: '2026-06-15', to: '2026-10-10' }
    },
    // What we have installed, along our own service lines. This is the table
    // that answers both "what am I supporting on this boat" and "which boats
    // are due a conversation" — the console flags anything past its age.
    systems: [
      { line: 'AV',     product: 'Placeholder control & entertainment', installed: '2026-07' },
      { line: 'IT',     product: 'Placeholder network & Wi-Fi core', installed: '2014-11' },
      { line: 'Security', product: 'Placeholder CCTV & access control', installed: '2026-07' }
    ],
    contacts: [
      { role: 'Captain', name: 'Placeholder Name', email: 'captain@example.invalid' },
      { role: 'Chief Engineer', name: 'Placeholder Name', email: 'engineer@example.invalid' }
    ],
    demo: {
      status: 'refit',
      speed: 0,
      position: [4.3900, 51.9050]    // Rotterdam
    }
  },

  {
    id: 'wind-verity',
    name: 'Wind Verity',
    prefix: 'S/Y',
    mmsi: 319000007,
    imo: 9900071,
    callSign: 'ZGAA7',
    flag: 'Cayman Islands',
    flagCode: 'KY',
    loa: 45.3, beam: 9.6, grossTonnage: 388,
    builder: 'Placeholder Yard',
    yearBuilt: 2020, lastRefit: null,
    classSociety: 'Bureau Veritas',
    photo: null,
    discreet: false,
    service: {
      nextEvent: 'Rig inspection',
      nextEventDate: '2026-09-26',
      engineer: 'C. Placeholder',
      openJobs: 4,
      urgentJobs: 0,
      partsOnOrder: [
        { item: 'Furler bearing set', eta: '2026-09-05', port: 'St Barths' }
      ],
      yardPeriod: null
    },
    // What we have installed, along our own service lines. This is the table
    // that answers both "what am I supporting on this boat" and "which boats
    // are due a conversation" — the console flags anything past its age.
    systems: [
      { line: 'AV',     product: 'Placeholder control & entertainment', installed: '2020-08' },
      { line: 'IT',     product: 'Placeholder network & Wi-Fi core', installed: '2020-08' },
      { line: 'Security', product: 'Placeholder CCTV & access control', installed: '2020-08' }
    ],
    contacts: [
      { role: 'Captain', name: 'Placeholder Name', email: 'captain@example.invalid' },
      { role: 'Chief Engineer', name: 'Placeholder Name', email: 'engineer@example.invalid' }
    ],
    demo: {
      status: 'underway',
      speed: 8.9,
      destination: 'ST BARTHS',
      etaHours: 9,
      route: [[-61.75, 17.12], [-62.10, 17.35], [-62.55, 17.65], [-62.83, 17.90]]  // Antigua → St Barths
    }
  },

  {
    id: 'petrel',
    name: 'Petrel',
    prefix: 'M/Y',
    mmsi: 319000008,
    imo: 9900083,
    callSign: 'ZGAA8',
    flag: 'Cayman Islands',
    flagCode: 'KY',
    loa: 42.1, beam: 8.4, grossTonnage: 340,
    builder: 'Placeholder Yard',
    yearBuilt: 2023, lastRefit: null,
    classSociety: 'RINA',
    photo: null,
    discreet: false,
    service: {
      nextEvent: 'Annual class survey',
      nextEventDate: '2026-08-31',
      engineer: 'B. Placeholder',
      openJobs: 5,
      urgentJobs: 1,
      partsOnOrder: [],
      yardPeriod: null
    },
    // What we have installed, along our own service lines. This is the table
    // that answers both "what am I supporting on this boat" and "which boats
    // are due a conversation" — the console flags anything past its age.
    systems: [
      { line: 'AV',     product: 'Placeholder control & entertainment', installed: '2023-02' },
      { line: 'IT',     product: 'Placeholder network & Wi-Fi core', installed: '2023-02' },
      { line: 'Security', product: 'Placeholder CCTV & access control', installed: '2023-02' }
    ],
    contacts: [
      { role: 'Captain', name: 'Placeholder Name', email: 'captain@example.invalid' },
      { role: 'Chief Engineer', name: 'Placeholder Name', email: 'engineer@example.invalid' }
    ],
    demo: {
      status: 'anchored',
      speed: 0.3,
      position: [-62.85, 17.90]      // St Barths
    }
  }
];
