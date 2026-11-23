/**
 * UK postcode AREA codes to the place names people actually say.
 *
 * ── WHY THIS IS A DISPLAY CONCERN AND NOTHING ELSE ────────────────────────
 * `model_demand_summary` buckets by area code and returns the code, because a
 * code is a stable key and a name is editorial. "E", "SE" and "W" are the
 * right thing to GROUP by and tell a stylist nothing at all to READ — she is
 * being shown where people are, in a card whose only job is to be legible.
 *
 * So the code stays in the data all the way to the component, and only the
 * label changes. Nothing keys off, sorts by, or compares these strings.
 *
 * ⚠️ AN UNKNOWN CODE RENDERS AS THE CODE. Royal Mail adds areas (and this
 * table is hand-written, so it can be wrong before they do). Falling back to
 * the code shows a stylist something true and slightly cryptic; inventing a
 * name from the letters would show her something false and confident. The
 * second is much worse and is the only reason this is a lookup with a
 * fallback rather than a formatter.
 *
 * ⚠️ THESE ARE POSTAL AREAS, NOT COUNCILS OR COUNTIES, and they do not agree
 * with either. "ME" is Medway and reaches well past it; "TS" is officially
 * Cleveland, an authority abolished in 1996. The names are Royal Mail's own
 * for the area, which is what a postcode actually belongs to — `users` also
 * carries `admin_district` and `bua` from postcodes.io (see lib/postcode.ts)
 * if a real council or town name is ever wanted instead. Do not mix the two
 * in one list: a stylist comparing "South East London" with "Southwark"
 * cannot tell they are different kinds of thing.
 *
 * The London areas are the ones that matter most today — 15 of the 15 models
 * in named areas are in E, SE or W (22 Nov 2026) — and they are also the
 * worst as bare codes, because a single letter looks like a typo.
 */
const AREA_NAMES: Record<string, string> = {
  // ── London ───────────────────────────────────────────────────────────────
  E: 'East London',
  EC: 'East Central London',
  N: 'North London',
  NW: 'North West London',
  SE: 'South East London',
  SW: 'South West London',
  W: 'West London',
  WC: 'West Central London',

  // ── Greater London and the commuter ring, which post under their own towns
  BR: 'Bromley',
  CR: 'Croydon',
  DA: 'Dartford',
  EN: 'Enfield',
  HA: 'Harrow',
  IG: 'Ilford',
  KT: 'Kingston upon Thames',
  RM: 'Romford',
  SM: 'Sutton',
  TW: 'Twickenham',
  UB: 'Uxbridge',
  WD: 'Watford',

  // ── England ──────────────────────────────────────────────────────────────
  AL: 'St Albans',
  B: 'Birmingham',
  BA: 'Bath',
  BB: 'Blackburn',
  BD: 'Bradford',
  BH: 'Bournemouth',
  BL: 'Bolton',
  BN: 'Brighton',
  BS: 'Bristol',
  CA: 'Carlisle',
  CB: 'Cambridge',
  CH: 'Chester',
  CM: 'Chelmsford',
  CO: 'Colchester',
  CT: 'Canterbury',
  CV: 'Coventry',
  CW: 'Crewe',
  DE: 'Derby',
  DH: 'Durham',
  DL: 'Darlington',
  DN: 'Doncaster',
  DT: 'Dorchester',
  DY: 'Dudley',
  EX: 'Exeter',
  FY: 'Blackpool',
  GL: 'Gloucester',
  GU: 'Guildford',
  HD: 'Huddersfield',
  HG: 'Harrogate',
  HP: 'Hemel Hempstead',
  HR: 'Hereford',
  HU: 'Hull',
  HX: 'Halifax',
  IP: 'Ipswich',
  L: 'Liverpool',
  LA: 'Lancaster',
  LE: 'Leicester',
  LN: 'Lincoln',
  LS: 'Leeds',
  LU: 'Luton',
  M: 'Manchester',
  ME: 'Medway',
  MK: 'Milton Keynes',
  NE: 'Newcastle upon Tyne',
  NG: 'Nottingham',
  NN: 'Northampton',
  NR: 'Norwich',
  OL: 'Oldham',
  OX: 'Oxford',
  PE: 'Peterborough',
  PL: 'Plymouth',
  PO: 'Portsmouth',
  PR: 'Preston',
  RG: 'Reading',
  RH: 'Redhill',
  S: 'Sheffield',
  SG: 'Stevenage',
  SK: 'Stockport',
  SL: 'Slough',
  SN: 'Swindon',
  SO: 'Southampton',
  SP: 'Salisbury',
  SR: 'Sunderland',
  SS: 'Southend-on-Sea',
  ST: 'Stoke-on-Trent',
  SY: 'Shrewsbury',
  TA: 'Taunton',
  TF: 'Telford',
  TN: 'Tonbridge',
  TQ: 'Torquay',
  TR: 'Truro',
  TS: 'Cleveland',
  WA: 'Warrington',
  WF: 'Wakefield',
  WN: 'Wigan',
  WR: 'Worcester',
  WS: 'Walsall',
  WV: 'Wolverhampton',
  YO: 'York',

  // ── Wales ────────────────────────────────────────────────────────────────
  CF: 'Cardiff',
  LD: 'Llandrindod Wells',
  LL: 'Llandudno',
  NP: 'Newport',
  SA: 'Swansea',

  // ── Scotland ─────────────────────────────────────────────────────────────
  AB: 'Aberdeen',
  DD: 'Dundee',
  DG: 'Dumfries',
  EH: 'Edinburgh',
  FK: 'Falkirk',
  G: 'Glasgow',
  HS: 'Outer Hebrides',
  IV: 'Inverness',
  KA: 'Kilmarnock',
  KW: 'Kirkwall',
  KY: 'Kirkcaldy',
  ML: 'Motherwell',
  PA: 'Paisley',
  PH: 'Perth',
  TD: 'Galashiels',
  ZE: 'Lerwick',

  // ── Northern Ireland, and the Crown Dependencies, which are their own
  //    postcode areas and are not part of the UK for every purpose. They are
  //    listed because a postcode here would otherwise render as two letters.
  BT: 'Belfast',
  GY: 'Guernsey',
  IM: 'Isle of Man',
  JE: 'Jersey',
}

/**
 * The place name for a postcode area code, or the code itself when there is
 * no mapping. Never returns an empty string for a non-empty input.
 *
 * ⚠️ UPPER-CASED BEFORE LOOKUP, not trusted to arrive that way. The function
 * already upper-cases, but a caller could pass a code from somewhere else and
 * a case-sensitive miss would fall back silently — correct behaviour hiding an
 * avoidable miss.
 */
export function postcodeAreaName(code: string): string {
  const key = code.trim().toUpperCase()
  return AREA_NAMES[key] ?? key
}

/** Whether a code has a name. For tests and checks, not for rendering. */
export function hasPostcodeAreaName(code: string): boolean {
  return code.trim().toUpperCase() in AREA_NAMES
}
