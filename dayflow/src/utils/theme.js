import { Platform } from 'react-native';

// The sheet aesthetic: DayFlow reads as one page of paper on a desk rather
// than a stack of app chrome. Everything visual is defined here so the screen
// and the row component stay in agreement.

// A4 is 210mm wide — about 794px at 96dpi. The sheet stops there and centres,
// so a wide window shows a page rather than a stretched list.
export const SHEET_MAX_WIDTH = 780;

// The main page is the exception, because it is not read like a page. It is
// two columns of short lines, and on a Mac window or an iPad in landscape a
// 780-wide sheet left more desk showing than paper — the list looked shrunk
// rather than laid out. So past the point where 780 stops filling the screen,
// the sheet takes about two thirds of the window, up to a width where each column
// is still a list and not a line of text crossing half the screen.
// The summaries and the forms keep SHEET_MAX_WIDTH: those are read.
const MAIN_SHEET_SHARE = 0.68;
const MAIN_SHEET_LIMIT = 1120;

export function mainSheetWidth(windowWidth) {
  return Math.max(SHEET_MAX_WIDTH, Math.min(MAIN_SHEET_LIMIT, Math.round(windowWidth * MAIN_SHEET_SHARE)));
}

// Every type size in the app goes through here, so the whole of it can be made
// larger or smaller in one place rather than in a hundred and seventy. Line
// heights too: a font that grows inside a fixed line height is clipped, and
// clipped at the bottom, where the descenders are. Rounded to half a point, the
// step the sizes were written in.
const TYPE_SCALE = 1.12;

export function typeSize(points) {
  return Math.round(points * TYPE_SCALE * 2) / 2;
}

export const COLORS = {
  desk: '#E9E6DF',        // surface the sheet sits on
  sheet: '#FFFFFF',
  sheetEdge: '#DCD7CC',

  ink: '#1A1A18',         // headings and task text
  inkSoft: '#57534B',     // secondary text
  inkFaint: '#96907F',    // hints, placeholders
  done: '#A9A296',        // completed task text

  rule: '#E6E2D8',        // hairline between rows
  pencil: '#211F1B',      // the two ruled lines: under the headings, and between the columns

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
