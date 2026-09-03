// Country/phone metadata: dial codes, formatting-as-you-type and Russian
// country names, grouped with CIS countries first (this app's core market),
// then the rest of the world by continent.

import { AsYouType, getCountryCallingCode, getCountries, parsePhoneNumberFromString } from 'libphonenumber-js';
import { countries as countryMeta } from 'countries-list';

export const DEFAULT_COUNTRY = 'UZ';

// Ordered by relevance to this app's market, not alphabetically.
const CIS_ORDER = ['UZ', 'RU', 'KZ', 'KG', 'TJ', 'TM', 'AZ', 'AM', 'BY', 'MD'];

const GROUP_LABELS = {
  cis: 'СНГ',
  AS: 'Азия',
  EU: 'Европа',
  NA: 'Северная Америка',
  SA: 'Южная Америка',
  AF: 'Африка',
  OC: 'Океания',
  AN: 'Антарктика',
};

let regionNames = null;
function countryName(iso2) {
  try {
    if (!regionNames) regionNames = new Intl.DisplayNames(['ru'], { type: 'region' });
    return regionNames.of(iso2) || countryMeta[iso2]?.name || iso2;
  } catch {
    return countryMeta[iso2]?.name || iso2;
  }
}

function buildEntry(iso2) {
  return { iso2, name: countryName(iso2), callingCode: getCountryCallingCode(iso2) };
}

let _groups = null;

export function getCountryGroups() {
  if (_groups) return _groups;

  const supported = getCountries().filter((iso2) => countryMeta[iso2]);
  const seen = new Set();
  const groups = [];

  const cis = { key: 'cis', label: GROUP_LABELS.cis, items: [] };
  CIS_ORDER.forEach((iso2) => {
    if (!supported.includes(iso2)) return;
    seen.add(iso2);
    cis.items.push(buildEntry(iso2));
  });
  groups.push(cis);

  ['AS', 'EU', 'NA', 'SA', 'AF', 'OC'].forEach((continent) => {
    const items = supported
      .filter((iso2) => !seen.has(iso2) && countryMeta[iso2]?.continent === continent)
      .map(buildEntry)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    items.forEach((entry) => seen.add(entry.iso2));
    if (items.length) groups.push({ key: continent, label: GROUP_LABELS[continent], items });
  });

  _groups = groups;
  return _groups;
}

export function flatCountryList() {
  return getCountryGroups().flatMap((g) => g.items);
}

export function findCountry(iso2) {
  return flatCountryList().find((c) => c.iso2 === iso2);
}

export function guessCountryFromValue(value, fallback = DEFAULT_COUNTRY) {
  if (value) {
    const parsed = parsePhoneNumberFromString(String(value), fallback);
    if (parsed && parsed.country) return parsed.country;
  }
  return fallback;
}

export function nationalDigitsFromValue(value, iso2) {
  if (!value) return '';
  const parsed = parsePhoneNumberFromString(String(value), iso2);
  if (parsed) return parsed.nationalNumber;
  return String(value).replace(/\D/g, '');
}

export function formatAsYouType(iso2, nationalDigits) {
  const formatter = new AsYouType(iso2);
  const formatted = formatter.input(nationalDigits || '');
  const num = formatter.getNumber();
  const callingCode = getCountryCallingCode(iso2);
  return {
    formatted,
    e164: num ? num.number : (nationalDigits ? `+${callingCode}${nationalDigits}` : ''),
  };
}
