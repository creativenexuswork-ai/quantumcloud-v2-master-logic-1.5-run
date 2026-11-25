import type { OhlcvBar } from './types';

export interface CsvParseResult {
  ok: true;
  bars: OhlcvBar[];
  provenance: {
    format: 'standard_ohlcv' | 'binance_spot_12col_headerless' | 'binance_futures_12col_header';
    timestampUnit: 'microseconds' | 'milliseconds' | 'seconds' | 'iso8601';
    rowCount: number;
    firstTs: number;
    lastTs: number;
  };
}

export interface CsvParseError {
  ok: false;
  errors: string[];
}

function normalizeTimestamp(rawTs: string): { ts: number; unit: 'microseconds' | 'milliseconds' | 'seconds' | 'iso8601' } {
  const numTs = Number(rawTs);
  if (Number.isFinite(numTs) && rawTs !== '') {
    // Binance Vision Spot switched to microseconds (>= 1e15) starting Jan 2025
    if (numTs >= 1e15) return { ts: Math.floor(numTs / 1000), unit: 'microseconds' };
    if (numTs >= 1e12) return { ts: numTs, unit: 'milliseconds' };
    return { ts: numTs * 1000, unit: 'seconds' };
  }
  return { ts: Date.parse(rawTs), unit: 'iso8601' };
}

/**
 * Parses OHLCV CSV in any of three supported formats:
 *  1. Standard 6-column OHLCV with header: timestamp,open,high,low,close,volume
 *  2. Official Binance Vision Spot 12-column headerless CSV (supports ms and 2025+ µs)
 *  3. Official Binance Vision USD-M Futures 12-column CSV with header (open_time,open,...)
 * Strictly validates monotonic timestamps and OHLC invariants.
 */
export function parseOhlcvCsv(csv: string): CsvParseResult | CsvParseError {
  const lines = csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return { ok: false, errors: ['CSV is empty'] };

  const firstCols = lines[0].split(',').map(c => c.trim());
  const firstIsNumeric = firstCols.length >= 12 && Number.isFinite(Number(firstCols[0])) && Number.isFinite(Number(firstCols[1]));

  let format: CsvParseResult['provenance']['format'] = 'standard_ohlcv';
  let startRow = 1;
  let tsIdx = 0, oIdx = 1, hIdx = 2, lIdx = 3, cIdx = 4, vIdx = 5;

  if (firstIsNumeric) {
    format = 'binance_spot_12col_headerless';
    startRow = 0;
  } else {
    if (lines.length < 2) return { ok: false, errors: ['CSV must contain a header and at least one data row'] };
    const header = firstCols.map(h => h.toLowerCase());
    tsIdx = header.findIndex(h => h === 'timestamp' || h === 'ts' || h === 'time' || h === 'date' || h === 'open_time');
    oIdx = header.indexOf('open');
    hIdx = header.indexOf('high');
    lIdx = header.indexOf('low');
    cIdx = header.indexOf('close');
    vIdx = header.indexOf('volume');
    if ([tsIdx, oIdx, hIdx, lIdx, cIdx, vIdx].some(i => i < 0)) {
      return { ok: false, errors: ['Missing required columns: timestamp/open_time, open, high, low, close, volume'] };
    }
    if (header[0] === 'open_time' && header.length >= 12) format = 'binance_futures_12col_header';
  }

  const bars: OhlcvBar[] = [];
  const errors: string[] = [];
  let detectedUnit: CsvParseResult['provenance']['timestampUnit'] = 'milliseconds';

  for (let i = startRow; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    const rawTs = cols[tsIdx];
    const { ts, unit } = normalizeTimestamp(rawTs);
    if (bars.length === 0) detectedUnit = unit;
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
  if (bars.length === 0) return { ok: false, errors: ['No valid OHLCV rows found'] };
  return {
    ok: true,
    bars,
    provenance: {
      format,
      timestampUnit: detectedUnit,
      rowCount: bars.length,
      firstTs: bars[0].ts,
      lastTs: bars[bars.length - 1].ts,
    },
  };
}