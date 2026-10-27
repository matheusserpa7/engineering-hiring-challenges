const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
// Months are 30 days and years 365, floored: a gift never looks older than it is.
const MONTH_DAYS = 30;
const YEAR_DAYS = 365;

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const count = new Intl.NumberFormat('en');
// UTC because a campaign's start and end are instants on its own calendar. Following the
// reader's zone would show "Jul 31" to a Chicago visitor for a campaign that opens Aug 1.
const campaignDate = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });

// `now` is a parameter so the boundaries are testable. A time ahead of `now` is clock skew
// between the server and the browser, and "in 3 minutes" for a past gift would be wrong.
export function relativeTime(iso: string, now: number = Date.now()): string {
  const elapsed = now - Date.parse(iso);
  if (elapsed < MINUTE_MS) return 'just now';
  if (elapsed < HOUR_MS) return relative.format(-Math.floor(elapsed / MINUTE_MS), 'minute');
  if (elapsed < DAY_MS) return relative.format(-Math.floor(elapsed / HOUR_MS), 'hour');

  const days = Math.floor(elapsed / DAY_MS);
  if (days < MONTH_DAYS) return relative.format(-days, 'day');
  if (days < YEAR_DAYS) {
    // Day 360 to 364 would floor to 12 months, which reads worse than "11 months ago".
    return relative.format(-Math.min(11, Math.floor(days / MONTH_DAYS)), 'month');
  }
  return relative.format(-Math.floor(days / YEAR_DAYS), 'year');
}

export function formatCampaignDate(iso: string): string {
  return campaignDate.format(Date.parse(iso));
}

export function donorCountLabel(donors: number): string {
  return `${count.format(donors)} ${donors === 1 ? 'donor' : 'donors'}`;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

// The first grapheme, not the first code point: a Devanagari cluster or a ZWJ emoji must not be
// cut in half. Display only, so it never parses "The … family".
export function avatarInitial(displayName: string): string {
  const first = graphemes.segment(displayName.trim())[Symbol.iterator]().next();
  return first.done ? '·' : first.value.segment;
}
