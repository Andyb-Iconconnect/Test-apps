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
 *   demo          starting state for DEMO MODE only; ignored once live AIS is on.
 *                 Needs one of `route`, `position: [lon, lat]`, or `port` named
 *                 from data/ports.js, or she never reaches the chart.
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
    // DEMO MODE ONLY, and invented — nothing here is a real position. Change
    // `port` to wherever she actually is (any name in data/ports.js), or give
    // `position: [lon, lat]`. The only way to show where she really is, is to
    // put an AISstream key in config.js: live AIS tracks her on her MMSI and
    // this whole block is ignored.
    demo: {
      status: 'moored',
      port: 'Göcek'
    }
  }
];
