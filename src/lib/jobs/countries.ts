/**
 * Country names for ONE narrow job: deciding whether a location token that stands ALONE is a country ("Ghana",
 * "UK", "Cameroon (CM)", the single token after "Remote, "). It is not a gazetteer and it is never used to hunt for a
 * country inside a longer string: `parseJobLocation` still treats the last comma-separated token of a multi-token
 * entry as the country by position, for the reason job-posting-jsonld.ts gives (a hand-kept place list goes stale
 * silently). What this adds is the one case position cannot answer: a lone token is either a city ("Lagos",
 * "Bangalore") or a country ("Ghana"), and guessing wrong invents either a country called Bangalore or drops Ghana.
 *
 * DATA, NOT RUNTIME ICU. The 249 ISO 3166-1 entries below are the CLDR English short names, generated once with
 * `Intl.DisplayNames` and committed, so a Node/ICU upgrade cannot silently change what resolves. The test pins the count.
 *
 * AMBIGUOUS_UNLESS_MARKED are names that are a country AND something else, so free text cannot be trusted to mean the
 * country: Georgia (a US state), Jersey (a US state and city), Congo (two countries). They resolve only where a SOURCE
 * marks a field as a country (schema.org `addressCountry` / `@type: Country`), which never goes through this module.
 */

const ISO_ENTRIES: ReadonlyArray<readonly [string, string]> = [
  ["AD", "Andorra"],
  ["AE", "United Arab Emirates"],
  ["AF", "Afghanistan"],
  ["AG", "Antigua & Barbuda"],
  ["AI", "Anguilla"],
  ["AL", "Albania"],
  ["AM", "Armenia"],
  ["AO", "Angola"],
  ["AQ", "Antarctica"],
  ["AR", "Argentina"],
  ["AS", "American Samoa"],
  ["AT", "Austria"],
  ["AU", "Australia"],
  ["AW", "Aruba"],
  ["AX", "Åland Islands"],
  ["AZ", "Azerbaijan"],
  ["BA", "Bosnia & Herzegovina"],
  ["BB", "Barbados"],
  ["BD", "Bangladesh"],
  ["BE", "Belgium"],
  ["BF", "Burkina Faso"],
  ["BG", "Bulgaria"],
  ["BH", "Bahrain"],
  ["BI", "Burundi"],
  ["BJ", "Benin"],
  ["BL", "St. Barthélemy"],
  ["BM", "Bermuda"],
  ["BN", "Brunei"],
  ["BO", "Bolivia"],
  ["BQ", "Caribbean Netherlands"],
  ["BR", "Brazil"],
  ["BS", "Bahamas"],
  ["BT", "Bhutan"],
  ["BV", "Bouvet Island"],
  ["BW", "Botswana"],
  ["BY", "Belarus"],
  ["BZ", "Belize"],
  ["CA", "Canada"],
  ["CC", "Cocos (Keeling) Islands"],
  ["CD", "Congo - Kinshasa"],
  ["CF", "Central African Republic"],
  ["CG", "Congo - Brazzaville"],
  ["CH", "Switzerland"],
  ["CI", "Côte d'Ivoire"],
  ["CK", "Cook Islands"],
  ["CL", "Chile"],
  ["CM", "Cameroon"],
  ["CN", "China"],
  ["CO", "Colombia"],
  ["CR", "Costa Rica"],
  ["CU", "Cuba"],
  ["CV", "Cape Verde"],
  ["CW", "Curaçao"],
  ["CX", "Christmas Island"],
  ["CY", "Cyprus"],
  ["CZ", "Czechia"],
  ["DE", "Germany"],
  ["DJ", "Djibouti"],
  ["DK", "Denmark"],
  ["DM", "Dominica"],
  ["DO", "Dominican Republic"],
  ["DZ", "Algeria"],
  ["EC", "Ecuador"],
  ["EE", "Estonia"],
  ["EG", "Egypt"],
  ["EH", "Western Sahara"],
  ["ER", "Eritrea"],
  ["ES", "Spain"],
  ["ET", "Ethiopia"],
  ["FI", "Finland"],
  ["FJ", "Fiji"],
  ["FK", "Falkland Islands"],
  ["FM", "Micronesia"],
  ["FO", "Faroe Islands"],
  ["FR", "France"],
  ["GA", "Gabon"],
  ["GB", "United Kingdom"],
  ["GD", "Grenada"],
  ["GE", "Georgia"],
  ["GF", "French Guiana"],
  ["GG", "Guernsey"],
  ["GH", "Ghana"],
  ["GI", "Gibraltar"],
  ["GL", "Greenland"],
  ["GM", "Gambia"],
  ["GN", "Guinea"],
  ["GP", "Guadeloupe"],
  ["GQ", "Equatorial Guinea"],
  ["GR", "Greece"],
  ["GS", "South Georgia & South Sandwich Islands"],
  ["GT", "Guatemala"],
  ["GU", "Guam"],
  ["GW", "Guinea-Bissau"],
  ["GY", "Guyana"],
  ["HK", "Hong Kong SAR China"],
  ["HM", "Heard & McDonald Islands"],
  ["HN", "Honduras"],
  ["HR", "Croatia"],
  ["HT", "Haiti"],
  ["HU", "Hungary"],
  ["ID", "Indonesia"],
  ["IE", "Ireland"],
  ["IL", "Israel"],
  ["IM", "Isle of Man"],
  ["IN", "India"],
  ["IO", "British Indian Ocean Territory"],
  ["IQ", "Iraq"],
  ["IR", "Iran"],
  ["IS", "Iceland"],
  ["IT", "Italy"],
  ["JE", "Jersey"],
  ["JM", "Jamaica"],
  ["JO", "Jordan"],
  ["JP", "Japan"],
  ["KE", "Kenya"],
  ["KG", "Kyrgyzstan"],
  ["KH", "Cambodia"],
  ["KI", "Kiribati"],
  ["KM", "Comoros"],
  ["KN", "St. Kitts & Nevis"],
  ["KP", "North Korea"],
  ["KR", "South Korea"],
  ["KW", "Kuwait"],
  ["KY", "Cayman Islands"],
  ["KZ", "Kazakhstan"],
  ["LA", "Laos"],
  ["LB", "Lebanon"],
  ["LC", "St. Lucia"],
  ["LI", "Liechtenstein"],
  ["LK", "Sri Lanka"],
  ["LR", "Liberia"],
  ["LS", "Lesotho"],
  ["LT", "Lithuania"],
  ["LU", "Luxembourg"],
  ["LV", "Latvia"],
  ["LY", "Libya"],
  ["MA", "Morocco"],
  ["MC", "Monaco"],
  ["MD", "Moldova"],
  ["ME", "Montenegro"],
  ["MF", "St. Martin"],
  ["MG", "Madagascar"],
  ["MH", "Marshall Islands"],
  ["MK", "North Macedonia"],
  ["ML", "Mali"],
  ["MM", "Myanmar (Burma)"],
  ["MN", "Mongolia"],
  ["MO", "Macao SAR China"],
  ["MP", "Northern Mariana Islands"],
  ["MQ", "Martinique"],
  ["MR", "Mauritania"],
  ["MS", "Montserrat"],
  ["MT", "Malta"],
  ["MU", "Mauritius"],
  ["MV", "Maldives"],
  ["MW", "Malawi"],
  ["MX", "Mexico"],
  ["MY", "Malaysia"],
  ["MZ", "Mozambique"],
  ["NA", "Namibia"],
  ["NC", "New Caledonia"],
  ["NE", "Niger"],
  ["NF", "Norfolk Island"],
  ["NG", "Nigeria"],
  ["NI", "Nicaragua"],
  ["NL", "Netherlands"],
  ["NO", "Norway"],
  ["NP", "Nepal"],
  ["NR", "Nauru"],
  ["NU", "Niue"],
  ["NZ", "New Zealand"],
  ["OM", "Oman"],
  ["PA", "Panama"],
  ["PE", "Peru"],
  ["PF", "French Polynesia"],
  ["PG", "Papua New Guinea"],
  ["PH", "Philippines"],
  ["PK", "Pakistan"],
  ["PL", "Poland"],
  ["PM", "St. Pierre & Miquelon"],
  ["PN", "Pitcairn Islands"],
  ["PR", "Puerto Rico"],
  ["PS", "Palestinian Territories"],
  ["PT", "Portugal"],
  ["PW", "Palau"],
  ["PY", "Paraguay"],
  ["QA", "Qatar"],
  ["RE", "Réunion"],
  ["RO", "Romania"],
  ["RS", "Serbia"],
  ["RU", "Russia"],
  ["RW", "Rwanda"],
  ["SA", "Saudi Arabia"],
  ["SB", "Solomon Islands"],
  ["SC", "Seychelles"],
  ["SD", "Sudan"],
  ["SE", "Sweden"],
  ["SG", "Singapore"],
  ["SH", "St. Helena"],
  ["SI", "Slovenia"],
  ["SJ", "Svalbard & Jan Mayen"],
  ["SK", "Slovakia"],
  ["SL", "Sierra Leone"],
  ["SM", "San Marino"],
  ["SN", "Senegal"],
  ["SO", "Somalia"],
  ["SR", "Suriname"],
  ["SS", "South Sudan"],
  ["ST", "São Tomé & Príncipe"],
  ["SV", "El Salvador"],
  ["SX", "Sint Maarten"],
  ["SY", "Syria"],
  ["SZ", "Eswatini"],
  ["TC", "Turks & Caicos Islands"],
  ["TD", "Chad"],
  ["TF", "French Southern Territories"],
  ["TG", "Togo"],
  ["TH", "Thailand"],
  ["TJ", "Tajikistan"],
  ["TK", "Tokelau"],
  ["TL", "Timor-Leste"],
  ["TM", "Turkmenistan"],
  ["TN", "Tunisia"],
  ["TO", "Tonga"],
  ["TR", "Türkiye"],
  ["TT", "Trinidad & Tobago"],
  ["TV", "Tuvalu"],
  ["TW", "Taiwan"],
  ["TZ", "Tanzania"],
  ["UA", "Ukraine"],
  ["UG", "Uganda"],
  ["UM", "U.S. Outlying Islands"],
  ["US", "United States"],
  ["UY", "Uruguay"],
  ["UZ", "Uzbekistan"],
  ["VA", "Vatican City"],
  ["VC", "St. Vincent & Grenadines"],
  ["VE", "Venezuela"],
  ["VG", "British Virgin Islands"],
  ["VI", "U.S. Virgin Islands"],
  ["VN", "Vietnam"],
  ["VU", "Vanuatu"],
  ["WF", "Wallis & Futuna"],
  ["WS", "Samoa"],
  ["YE", "Yemen"],
  ["YT", "Mayotte"],
  ["ZA", "South Africa"],
  ["ZM", "Zambia"],
  ["ZW", "Zimbabwe"],
];

/** Display names where CLDR's short form is awkward in a posting's address. Keyed by alpha-2. */
const DISPLAY_OVERRIDES: Readonly<Record<string, string>> = {
  CD: "Democratic Republic of the Congo",
  CG: "Republic of the Congo",
  MM: "Myanmar",
  HK: "Hong Kong",
  MO: "Macao",
};

/**
 * The explicit alias table: names a source plausibly writes that are not the CLDR short name. Each entry is tested.
 * Values are alpha-2 codes (or "XK" for Kosovo, which is not ISO-assigned but is stated by sources as a country).
 */
export const ALIASES: Readonly<Record<string, string>> = {
  UK: "GB",
  "U.K.": "GB",
  USA: "US",
  "U.S.A.": "US",
  US: "US",
  UAE: "AE",
  "Ivory Coast": "CI",
  Turkey: "TR",
  "Czech Republic": "CZ",
  "DR Congo": "CD",
  "Democratic Republic of the Congo": "CD",
  "Republic of the Congo": "CG",
  Kosovo: "XK",
};

export const AMBIGUOUS_UNLESS_MARKED: ReadonlySet<string> = new Set(["Georgia", "Jersey", "Congo"]);

export const ISO_COUNTRY_COUNT = ISO_ENTRIES.length;

/** Lowercase, no diacritics, "&" as "and", no apostrophes or full stops, single spaces. */
function key(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’'`.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function displayName(code: string, cldr: string): string {
  return DISPLAY_OVERRIDES[code] ?? cldr.replace(/ & /g, " and ");
}

const BY_CODE = new Map<string, string>();
const BY_KEY = new Map<string, string>(); // normalised name -> alpha-2
for (const [code, cldr] of ISO_ENTRIES) {
  BY_CODE.set(code, displayName(code, cldr));
  BY_KEY.set(key(cldr), code);
  BY_KEY.set(key(displayName(code, cldr)), code);
}
BY_CODE.set("XK", "Kosovo");
for (const [alias, code] of Object.entries(ALIASES)) BY_KEY.set(key(alias), code);
for (const name of AMBIGUOUS_UNLESS_MARKED) BY_KEY.delete(key(name));

/**
 * The country a lone location token names, as the name to print in an address, or null.
 * "Cameroon (CM)" resolves only when the parenthesised code is that country's own code.
 */
export function resolveCountry(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const withCode = /^(.*\S)\s*\(([A-Za-z]{2})\)$/.exec(text);
  if (withCode) {
    const code = BY_KEY.get(key(withCode[1]!));
    return code && code === withCode[2]!.toUpperCase() ? BY_CODE.get(code)! : null;
  }
  const code = BY_KEY.get(key(text));
  return code ? BY_CODE.get(code)! : null;
}
