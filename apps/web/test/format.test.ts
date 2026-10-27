import { afterEach, describe, expect, it } from 'vitest';
import { donorCountLabel, formatCampaignDate, relativeTime } from '../src/format';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function ago(ms: number): string {
  return relativeTime(new Date(NOW - ms).toISOString(), NOW);
}

describe('relativeTime boundaries', () => {
  it.each([
    ['59 seconds', 59 * SECOND, 'just now'],
    ['0 seconds', 0, 'just now'],
    ['60 seconds', MINUTE, '1 minute ago'],
    ['59 minutes 59 seconds', HOUR - SECOND, '59 minutes ago'],
    ['1 hour', HOUR, '1 hour ago'],
    ['23 hours 59 minutes', DAY - MINUTE, '23 hours ago'],
    ['24 hours', DAY, 'yesterday'],
    ['29 days', 29 * DAY, '29 days ago'],
    ['30 days', 30 * DAY, 'last month'],
    ['59 days', 59 * DAY, 'last month'],
    ['60 days', 60 * DAY, '2 months ago'],
    ['364 days', 364 * DAY, '11 months ago'],
    ['365 days', 365 * DAY, 'last year'],
    ['729 days', 729 * DAY, 'last year'],
    ['730 days', 730 * DAY, '2 years ago'],
  ])('%s old reads %s', (_label, ms, expected) => {
    expect(ago(ms)).toBe(expected);
  });

  it('never shows a time in the future: clock skew reads as just now', () => {
    expect(relativeTime(new Date(NOW + 5 * MINUTE).toISOString(), NOW)).toBe('just now');
  });
});

describe('formatCampaignDate', () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  // Midnight UTC is still the day before in Chicago: the date must not follow the reader's
  // zone, because the campaign's own calendar is fixed.
  it.each(['America/Chicago', 'Asia/Kathmandu', 'Pacific/Kiritimati'])(
    'shows Aug 1, 2026 for 2026-08-01T00:00:00Z under %s',
    (tz) => {
      process.env.TZ = tz;

      expect(formatCampaignDate('2026-08-01T00:00:00Z')).toBe('Aug 1, 2026');
    },
  );
});

describe('donorCountLabel', () => {
  it.each([
    [0, '0 donors'],
    [1, '1 donor'],
    [46, '46 donors'],
    [1234, '1,234 donors'],
  ])('%i reads %s', (count, expected) => {
    expect(donorCountLabel(count)).toBe(expected);
  });
});
