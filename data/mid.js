/* -----------------------------------------------------------------------------
 * mid.js — Maritime Identification Digits: the first three of an MMSI.
 *
 * An MMSI is not an arbitrary number. Its leading three digits are allocated by
 * the ITU to a flag administration, so a vessel's flag falls out of her MMSI
 * with no lookup, no network and no typing. Everything a yacht might fly is
 * here; the rest of the world's 250-odd codes are not, because an unknown MID
 * leaves the field blank to be filled in by hand, which is honest, and a wrong
 * guess would not be.
 *
 * Source: the ITU MID allocation, via aisstream's own reference data. Codes are
 * stable — reallocations are rare and announced years ahead.
 *
 * Format: MID -> [ISO 3166-1 alpha-2, name as it should be displayed]
 * -------------------------------------------------------------------------- */

window.MID = {
  /* --- Europe ---------------------------------------------------------- */
  201: ['AL', 'Albania'],        202: ['AD', 'Andorra'],
  203: ['AT', 'Austria'],        204: ['PT', 'Azores'],
  205: ['BE', 'Belgium'],        206: ['BY', 'Belarus'],
  207: ['BG', 'Bulgaria'],       208: ['VA', 'Vatican City'],
  209: ['CY', 'Cyprus'],         210: ['CY', 'Cyprus'],
  211: ['DE', 'Germany'],        212: ['CY', 'Cyprus'],
  213: ['GE', 'Georgia'],        214: ['MD', 'Moldova'],
  215: ['MT', 'Malta'],          216: ['AM', 'Armenia'],
  218: ['DE', 'Germany'],        219: ['DK', 'Denmark'],
  220: ['DK', 'Denmark'],        224: ['ES', 'Spain'],
  225: ['ES', 'Spain'],          226: ['FR', 'France'],
  227: ['FR', 'France'],         228: ['FR', 'France'],
  229: ['MT', 'Malta'],          230: ['FI', 'Finland'],
  231: ['FO', 'Faroe Islands'],  232: ['GB', 'United Kingdom'],
  233: ['GB', 'United Kingdom'], 234: ['GB', 'United Kingdom'],
  235: ['GB', 'United Kingdom'], 236: ['GI', 'Gibraltar'],
  237: ['GR', 'Greece'],         238: ['HR', 'Croatia'],
  239: ['GR', 'Greece'],         240: ['GR', 'Greece'],
  241: ['GR', 'Greece'],         242: ['MA', 'Morocco'],
  243: ['HU', 'Hungary'],        244: ['NL', 'Netherlands'],
  245: ['NL', 'Netherlands'],    246: ['NL', 'Netherlands'],
  247: ['IT', 'Italy'],          248: ['MT', 'Malta'],
  249: ['MT', 'Malta'],          250: ['IE', 'Ireland'],
  251: ['IS', 'Iceland'],        252: ['LI', 'Liechtenstein'],
  253: ['LU', 'Luxembourg'],     254: ['MC', 'Monaco'],
  255: ['PT', 'Madeira'],        256: ['MT', 'Malta'],
  257: ['NO', 'Norway'],         258: ['NO', 'Norway'],
  259: ['NO', 'Norway'],         261: ['PL', 'Poland'],
  262: ['ME', 'Montenegro'],     263: ['PT', 'Portugal'],
  264: ['RO', 'Romania'],        265: ['SE', 'Sweden'],
  266: ['SE', 'Sweden'],         267: ['SK', 'Slovakia'],
  268: ['SM', 'San Marino'],     269: ['CH', 'Switzerland'],
  270: ['CZ', 'Czech Republic'], 271: ['TR', 'Turkey'],
  272: ['UA', 'Ukraine'],        273: ['RU', 'Russia'],
  275: ['LV', 'Latvia'],         276: ['EE', 'Estonia'],
  277: ['LT', 'Lithuania'],      278: ['SI', 'Slovenia'],
  279: ['RS', 'Serbia'],

  /* --- The Americas and the Caribbean ---------------------------------- */
  301: ['AI', 'Anguilla'],       304: ['AG', 'Antigua and Barbuda'],
  305: ['AG', 'Antigua and Barbuda'],
  306: ['CW', 'Curaçao'],        308: ['BS', 'Bahamas'],
  309: ['BS', 'Bahamas'],        310: ['BM', 'Bermuda'],
  311: ['BS', 'Bahamas'],        312: ['BZ', 'Belize'],
  314: ['BB', 'Barbados'],       316: ['CA', 'Canada'],
  319: ['KY', 'Cayman Islands'], 325: ['DM', 'Dominica'],
  330: ['GD', 'Grenada'],        334: ['HN', 'Honduras'],
  338: ['US', 'United States'],  339: ['JM', 'Jamaica'],
  341: ['KN', 'Saint Kitts and Nevis'],
  343: ['LC', 'Saint Lucia'],    345: ['MX', 'Mexico'],
  348: ['MS', 'Montserrat'],     350: ['NI', 'Nicaragua'],
  351: ['PA', 'Panama'],         352: ['PA', 'Panama'],
  353: ['PA', 'Panama'],         354: ['PA', 'Panama'],
  355: ['PA', 'Panama'],         356: ['PA', 'Panama'],
  357: ['PA', 'Panama'],         358: ['PR', 'Puerto Rico'],
  362: ['TT', 'Trinidad and Tobago'],
  364: ['TC', 'Turks and Caicos Islands'],
  366: ['US', 'United States'],  367: ['US', 'United States'],
  368: ['US', 'United States'],  369: ['US', 'United States'],
  370: ['PA', 'Panama'],         371: ['PA', 'Panama'],
  372: ['PA', 'Panama'],         373: ['PA', 'Panama'],
  374: ['PA', 'Panama'],
  375: ['VC', 'Saint Vincent and the Grenadines'],
  376: ['VC', 'Saint Vincent and the Grenadines'],
  377: ['VC', 'Saint Vincent and the Grenadines'],
  378: ['VG', 'British Virgin Islands'],
  379: ['VI', 'US Virgin Islands'],
  701: ['AR', 'Argentina'],      710: ['BR', 'Brazil'],
  725: ['CL', 'Chile'],          730: ['CO', 'Colombia'],

  /* --- Asia, the Middle East and the Pacific --------------------------- */
  403: ['SA', 'Saudi Arabia'],   412: ['CN', 'China'],
  416: ['TW', 'Taiwan'],         419: ['IN', 'India'],
  428: ['IL', 'Israel'],         431: ['JP', 'Japan'],
  440: ['KR', 'South Korea'],    466: ['QA', 'Qatar'],
  470: ['AE', 'United Arab Emirates'],
  471: ['AE', 'United Arab Emirates'],
  477: ['HK', 'Hong Kong'],      503: ['AU', 'Australia'],
  512: ['NZ', 'New Zealand'],    518: ['CK', 'Cook Islands'],
  538: ['MH', 'Marshall Islands'],
  563: ['SG', 'Singapore'],      564: ['SG', 'Singapore'],
  565: ['SG', 'Singapore'],      567: ['TH', 'Thailand'],
  576: ['VU', 'Vanuatu'],        577: ['VU', 'Vanuatu'],

  /* --- Africa and the Indian Ocean ------------------------------------- */
  601: ['ZA', 'South Africa'],   622: ['EG', 'Egypt'],
  636: ['LR', 'Liberia'],        637: ['LR', 'Liberia'],
  645: ['MU', 'Mauritius'],      664: ['SC', 'Seychelles'],
  667: ['SL', 'Sierra Leone'],   671: ['TG', 'Togo'],
  674: ['TZ', 'Tanzania'],       677: ['TZ', 'Tanzania']
};
