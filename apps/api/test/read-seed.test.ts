import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SeedError, parseSeed } from '../src/db/seed/read-seed.js';

const seedDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../roles/full-stack-engineer/seed',
);
const campaignsJson = readFileSync(resolve(seedDir, 'campaigns.json'), 'utf8');
// Normalised to LF so the edit helpers below do not depend on the checkout's line endings.
const donationsLf = readFileSync(resolve(seedDir, 'donations.csv'), 'utf8').replace(/\r?\n/g, '\n');

const parse = (donationsCsv: string) => parseSeed({ campaignsJson, donationsCsv });
const real = parse(donationsLf);

const row = (n: number) => {
  const found = real.donations[n - 1];
  if (found === undefined) throw new Error(`seed row ${String(n)} missing`);
  return found;
};

// Each bad-input test edits one cell of row 4 (a plain, unquoted row), so the
// sanity test below proves the only defect is the edit.
const row4Intact =
  'HCC-2026-000004,aangan-courtyard,Sunil Karki,sunil.karki@example.com,1.00,completed,public,,,Every little bit.,false,2026-08-02T10:02:00Z';
const edit4 = (from: string, to: string): string => {
  const edited = row4Intact.replace(from, to);
  expect(edited).not.toBe(row4Intact);
  return donationsLf.replace(row4Intact, edited);
};

const errorOf = (run: () => unknown): SeedError => {
  try {
    run();
  } catch (e) {
    expect(e).toBeInstanceOf(SeedError);
    return e as SeedError;
  }
  throw new Error('expected a SeedError, but nothing was thrown');
};
const messageOf = (run: () => unknown): string => errorOf(run).message;

const expectSeedError = (csv: string, receipt: string | null, forbidden: string[]) => {
  const err = errorOf(() => parse(csv));
  if (receipt !== null) {
    expect(err.receiptNumber).toBe(receipt);
    expect(err.message).toContain(receipt);
  }
  for (const secret of forbidden) expect(err.message).not.toContain(secret);
};

const row4Pii = ['Sunil Karki', 'sunil.karki', 'Every little bit'];

describe('parseSeed on the real seed files', () => {
  it('reads 3 campaigns and 75 donations', () => {
    expect(real.campaigns).toHaveLength(3);
    expect(real.donations).toHaveLength(75);
  });

  it('counts 66 completed, 7 refunded, 2 failed', () => {
    const count = (s: string) => real.donations.filter((d) => d.status === s).length;
    expect([count('completed'), count('refunded'), count('failed')]).toEqual([66, 7, 2]);
  });

  it('counts 48 public, 15 anonymous, 12 family', () => {
    const count = (p: string) => real.donations.filter((d) => d.privacyMode === p).length;
    expect([count('public'), count('anonymous'), count('family')]).toEqual([48, 15, 12]);
  });

  it('keeps a comma and double quotes in row 1 name byte for byte', () => {
    expect(row(1).donorName).toBe('Shrestha, Bijay "BJ"');
    expect(row(1).message).toBe('Thank you for everything, Aama.');
  });

  it('returns row 2 Devanagari name, dedication and message in NFC', () => {
    const d = row(2);
    expect(d.donorName).toBe('अनिशा गुरुङ'.normalize('NFC'));
    expect(d.dedicationName).toBe('बुबा'.normalize('NFC'));
    expect(d.message).toBe('सधैं सम्झनामा।'.normalize('NFC'));
    for (const text of [d.donorName, d.dedicationName, d.message]) {
      expect(text).toBe((text as string).normalize('NFC'));
    }
  });

  it('NFC-normalises text that arrives decomposed', () => {
    const decomposed = 'José';
    const csv = donationsLf.replace('Sunil Karki', decomposed);
    expect(parse(csv).donations[3]?.donorName).toBe('José');
  });

  it('converts $25,000.00 to exactly 2500000 cents and $1.00 to 100', () => {
    expect(row(3).amountCents).toBe(2_500_000);
    expect(row(4).amountCents).toBe(100);
  });

  it('gives every donation a safe integer amountCents', () => {
    for (const d of real.donations) expect(Number.isSafeInteger(d.amountCents)).toBe(true);
  });

  it('sums completed aangan-courtyard donations to 4305800 cents', () => {
    const total = real.donations
      .filter((d) => d.campaignSlug === 'aangan-courtyard' && d.status === 'completed')
      .reduce((sum, d) => sum + d.amountCents, 0);
    expect(total).toBe(4_305_800);
  });

  it('lower-cases emails so rows 11 and 12 become the same address', () => {
    const rawEmails = [11, 12].map((n) => {
      const line = donationsLf.split('\n').find((l) => l.startsWith(`HCC-2026-0000${String(n)},`));
      return line?.split(',')[3] ?? '';
    });
    expect(rawEmails[0]).not.toBe(rawEmails[1]);
    expect(rawEmails[0]?.toLowerCase()).toBe(rawEmails[1]?.toLowerCase());
    expect(row(11).donorEmail).toBe(row(12).donorEmail);
    expect(row(11).donorEmail).toBe('arjun.bhattarai@example.com');
  });

  it('preserves the row 9 script payload verbatim (escaping is the output job)', () => {
    expect(row(9).message).toBe('<script>alert(1)</script>');
    expect(row(10).message).toBe('<img src=x onerror="alert(document.cookie)">');
  });

  // The README calls it "at the limit", but the file has 283 (assumption A1). The parser must
  // keep it whole: truncating would destroy data, and the import exemption is what admits it.
  it('keeps the row 14 message whole at 283 code points, above the 280 limit', () => {
    expect(Array.from(row(14).message ?? '')).toHaveLength(283);
  });

  it('accepts row 71, a dedication type with no dedication name', () => {
    expect(row(71)).toMatchObject({ dedicationType: 'in_honor_of', dedicationName: null });
  });

  it('keeps the row 13 emoji intact', () => {
    expect(row(13).message).toBe('She fed anybody who walked in. 🙏');
  });

  it('turns blank dedication and message cells into null, not empty strings', () => {
    const r3 = row(3);
    expect(r3.dedicationType).toBeNull();
    expect(r3.dedicationName).toBeNull();
    expect(r3.message).toBeNull();
    const r4 = row(4);
    expect(r4.dedicationType).toBeNull();
    expect(r4.dedicationName).toBeNull();
    expect(r4.message).toBe('Every little bit.');
  });

  it('maps dedication and recurring fields and parses created_at as UTC', () => {
    expect(row(1).dedicationType).toBe('in_honor_of');
    expect(row(1).dedicationName).toBe('Aama');
    expect(row(2).dedicationType).toBe('in_memory_of');
    expect(row(12).isRecurring).toBe(true);
    expect(row(1).isRecurring).toBe(false);
    expect(row(1).createdAt).toEqual(new Date('2026-08-01T15:04:00Z'));
  });

  it('reads campaign money, presets, end date and active flag', () => {
    const bySlug = new Map(real.campaigns.map((c) => [c.slug, c]));
    const courtyard = bySlug.get('aangan-courtyard');
    expect(courtyard?.goalCents).toBe(15_000_000);
    expect(courtyard?.presetCents).toEqual([2100, 5100, 10100, 50100, 100100]);
    expect(courtyard?.minCents).toBe(100);
    expect(courtyard?.maxCents).toBe(2_500_000);
    expect(courtyard?.startsAt).toEqual(new Date('2026-08-01T00:00:00Z'));
    expect(bySlug.get('annadaan-kitchen')?.endsAt).toBeNull();
    expect(bySlug.get('roof-repair-2025')?.isActive).toBe(false);
  });
});

describe('parseSeed line endings and BOM', () => {
  it('gives identical records for LF and CRLF files', () => {
    const lf = donationsLf;
    const crlf = donationsLf.replace(/\r?\n/g, '\r\n');
    expect(crlf).toContain('\r\n');
    expect(parse(crlf)).toEqual(parse(lf));
  });

  it('gives the same records when the CSV starts with a BOM', () => {
    expect(parse('﻿' + donationsLf)).toEqual(real);
  });
});

describe('parseSeed rejects a bad seed without leaking row content', () => {
  it('parses the unmodified edit target, so the cases below fail for one defect only', () => {
    expect(donationsLf).toContain(row4Intact);
    expect(() => parse(donationsLf)).not.toThrow();
  });

  it('rejects an amount of 12.345 naming the receipt number but not the donor', () => {
    expectSeedError(edit4('example.com,1.00,', 'example.com,12.345,'), 'HCC-2026-000004', row4Pii);
  });

  it('rejects an unknown status', () => {
    expectSeedError(edit4(',completed,', ',settled,'), 'HCC-2026-000004', row4Pii);
  });

  it('rejects an unknown privacy mode', () => {
    expectSeedError(edit4(',public,', ',secret,'), 'HCC-2026-000004', row4Pii);
  });

  it('rejects a campaign slug that is not in campaigns.json', () => {
    expectSeedError(edit4(',aangan-courtyard,', ',nowhere-fund,'), 'HCC-2026-000004', row4Pii);
  });

  it('rejects a duplicate receipt number', () => {
    expectSeedError(edit4('HCC-2026-000004,', 'HCC-2026-000003,'), 'HCC-2026-000003', [
      ...row4Pii,
      'Priya Adhikari',
      'priya.adhikari',
    ]);
  });

  it('rejects an unparseable created_at', () => {
    expectSeedError(edit4('2026-08-02T10:02:00Z', 'yesterday-ish'), 'HCC-2026-000004', row4Pii);
  });

  it('rejects a malformed CSV with an unbalanced quote, reporting only the csv-parse code', () => {
    expectSeedError(edit4('Sunil Karki', '"Sunil Karki'), null, row4Pii);
    expect(messageOf(() => parse(edit4('Sunil Karki', '"Sunil Karki')))).toMatch(
      /^donations\.csv could not be parsed \(CSV_[A-Z_]+\)$/,
    );
  });

  it('rejects a row with one column too many, reporting only the csv-parse code', () => {
    const csv = donationsLf.replace(row4Intact, `${row4Intact},extra`);
    expectSeedError(csv, null, row4Pii);
    expect(messageOf(() => parse(csv))).toContain('CSV_RECORD_INCONSISTENT_COLUMNS');
  });

  it('rejects an unknown column in the header', () => {
    expectSeedError(donationsLf.replace('is_recurring', 'is_recurring_x'), null, row4Pii);
  });

  it('rejects an email address that is not one', () => {
    expectSeedError(edit4('sunil.karki@example.com', 'not-an-email'), 'HCC-2026-000004', row4Pii);
  });

  it('rejects a calendar date that does not exist instead of rolling it over', () => {
    expectSeedError(
      edit4('2026-08-02T10:02:00Z', '2026-02-30T10:02:00Z'),
      'HCC-2026-000004',
      row4Pii,
    );
  });

  // A shifted column puts personal data where the receipt number should be. The error must
  // name the row by position and never echo the cell.
  it('does not echo a receipt cell that holds personal data', () => {
    const csv = edit4('HCC-2026-000004,', 'sunil.karki@example.com,');
    expectSeedError(csv, null, [...row4Pii, 'example.com']);
    expect(errorOf(() => parse(csv)).receiptNumber).toBeNull();
  });

  it.each([
    ['trailing space', 'HCC-2026-000004 ,'],
    ['lower case', 'hcc-2026-000004,'],
    ['too few digits', 'HCC-2026-4,'],
  ])('rejects a receipt number with %s', (_label, cell) => {
    const csv = edit4('HCC-2026-000004,', cell);
    expectSeedError(csv, null, row4Pii);
    expect(errorOf(() => parse(csv)).receiptNumber).toBeNull();
  });

  // An empty file (a failed COPY into the image, say) must not look like a successful seed.
  it.each([
    ['an empty file', ''],
    ['a header-only file', donationsLf.split('\n')[0] ?? ''],
  ])('rejects %s', (_label, csv) => {
    expect(messageOf(() => parse(csv))).toContain('no rows');
  });
});

describe('parseSeed rejects a bad campaigns.json', () => {
  const withCampaigns = (change: (campaigns: Record<string, unknown>[]) => void): string => {
    const campaigns = JSON.parse(campaignsJson) as Record<string, unknown>[];
    change(campaigns);
    return JSON.stringify(campaigns);
  };
  const fails = (json: string): string =>
    messageOf(() => parseSeed({ campaignsJson: json, donationsCsv: donationsLf }));

  it('rejects an object with an unknown extra key, naming the file', () => {
    const json = withCampaigns((campaigns) => {
      Object.assign(campaigns[0] ?? {}, { surprise: true });
    });
    expect(fails(json)).toContain('campaigns.json is invalid');
  });

  it('rejects text that is not JSON', () => {
    expect(fails('{ not json')).toBe('campaigns.json is not valid JSON');
  });

  // Like a duplicate receipt, the database would silently skip the second campaign.
  it('rejects two campaigns with the same slug', () => {
    const json = withCampaigns((campaigns) => {
      campaigns.push({ ...campaigns[0] });
    });
    expect(fails(json)).toContain('duplicated');
  });

  it('rejects a currency that is not three upper-case letters', () => {
    const json = withCampaigns((campaigns) => {
      Object.assign(campaigns[0] ?? {}, { currency: 'usd' });
    });
    expect(fails(json)).toContain('currency');
  });
});
