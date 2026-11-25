import type { OhlcvBar } from './types';

export interface CsvParseResult {
  ok: true;
  bars: OhlcvBar[];
}

export interface CsvParseError {
  ok: false;
  errors: string[];
}

/**
 * Parses OHLCV CSV with header: timestamp,open,high,low,close,volume
 * (timestamp may be Unix ms, Unix seconds, or ISO-8601 string).
 * Strictly validates monotonic timestamps and OHLC invariants.
 */
export function parseOhlcvCsv(csv: string): CsvParseResult | CsvParseError {
  const lines = csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { ok: false, errors: ['CSV must contain a header and at least one data row'] };

  const header = lines[0].toLowerCase().split(',').map(h => h.trim());
  const tsIdx = header.findIndex(h => h === 'timestamp' || h === 'ts' || h === 'time' || h === 'date');
  const oIdx = header.indexOf('open');
  const hIdx = header.indexOf('high');
  const lIdx = header.indexOf('low');
  const cIdx = header.indexOf('close');
  const vIdx = header.indexOf('volume');

  if ([tsIdx, oIdx, hIdx, lIdx, cIdx, vIdx].some(i => i < 0)) {
    return { ok: false, errors: ['Missing required columns: timestamp, open, high, low, close, volume'] };
  }

  const bars: OhlcvBar[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    const rawTs = cols[tsIdx];
    const numTs = Number(rawTs);
    const ts = Number.isFinite(numTs)
      ? (numTs < 1e12 ? numTs * 1000 : numTs)
      : Date.parse(rawTs);
    const open = Number(cols[oIdx]);
    const high = Number(cols[hIdx]);
    const low = Number(cols[lIdx]);
    const close = Number(cols[cIdx]);
    const volume = Number(cols[vIdx]);

    if (!Number.isFinite(ts)) { errors.push(`Row ${i}: invalid timestamp "${rawTs}"`); continue; }
    if (![open, high, low, close].every(v => Number.isFinite(v) && v > 0)) {
      errors.push(`Row ${i}: OHLC values must be finite positive numbers`);
      continue;
    }
    if (!Number.isFinite(volume) || volume < 0) {
      errors.push(`Row ${i}: volume must be >= 0`);
      continue;
    }
    if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) {
      errors.push(`Row ${i}: OHLC invariant violated (high=${high}, low=${low}, open=${open}, close=${close})`);
      continue;
    }
    if (bars.length > 0 && ts <= bars[bars.length - 1].ts) {
      errors.push(`Row ${i}: non-monotonic timestamp (${ts} <= ${bars[bars.length - 1].ts})`);
      continue;
    }
    bars.push({ ts, open, high, low, close, volume });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, bars };
}