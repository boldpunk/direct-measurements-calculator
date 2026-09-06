// Country/phone metadata: dial codes, formatting-as-you-type and Russian
// country names. Only CIS countries are offered in the picker (this app's
// market); libphonenumber-js's full metadata is still used to parse/format
// any number regardless of country, so existing non-CIS numbers still work.

import { AsYouType, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js';

export const DEFAULT_COUNTRY = 'UZ';

// Ordered by relevance to this app's market, not alphabetically.
const CIS_ORDER = ['UZ', 'RU', 'KZ', 'KG', 'TJ', 'TM', 'AZ', 'AM', 'BY', 'MD'];

let regionNames = null;
function countryName(iso2) {
  try {
    if (!regionNames) regionNames = new Intl.DisplayNames(['ru'], { type: 'region' });
    return regionNames.of(iso2) || iso2;
  } catch {
    return iso2;
  }
}

function buildEntry(iso2) {
  return { iso2, name: countryName(iso2), callingCode: getCountryCallingCode(iso2) };
}

let _groups = null;

export function getCountryGroups() {
  if (!_groups) {
    _groups = [{ key: 'cis', label: 'СНГ', items: CIS_ORDER.map(buildEntry) }];
  }
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
