import { Platform } from 'react-native';

// The sheet aesthetic: DayFlow reads as one page of paper on a desk rather
// than a stack of app chrome. Everything visual is defined here so the screen
// and the row component stay in agreement.

// A4 is 210mm wide — about 794px at 96dpi. The sheet stops there and centres,
// so a wide window shows a page rather than a stretched list.
export const SHEET_MAX_WIDTH = 780;

export const COLORS = {
  desk: '#E9E6DF',        // surface the sheet sits on
  sheet: '#FFFFFF',
  sheetEdge: '#DCD7CC',

  ink: '#1A1A18',         // headings and task text
  inkSoft: '#57534B',     // secondary text
  inkFaint: '#96907F',    // hints, placeholders
  done: '#A9A296',        // completed task text

  rule: '#E2DED4',        // hairline between rows
  ruleStrong: '#2B2A26',  // the divider between the two lists

  accent: '#7A1F1F',      // the red pen: high priority, amounts owed
  check: '#1A1A18',
};

// Serif for anything that reads as document furniture — the date, the section
// headings — and the system sans for task text, which people scan rather than
// read.
export const SERIF = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'Georgia, "Times New Roman", Times, serif',
});

export const SANS = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
});

// Section headings: small, letterspaced, uppercase — a ledger label, not a
// screen title.
export const SECTION_LABEL = {
  fontFamily: SANS,
  fontSize: 11,
  fontWeight: '700',
  letterSpacing: 1.6,
  textTransform: 'uppercase',
  color: COLORS.inkSoft,
};

export const CURRENCY_SYMBOLS = { USD: '$', GBP: '£', EUR: '€', ETB: 'Br' };

export function currencySymbol(code) {
  return CURRENCY_SYMBOLS[code] || '$';
}
