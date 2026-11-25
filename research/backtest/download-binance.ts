/**
 * Official Binance Vision Public Archive Downloader (Research Only).
 * Downloads monthly kline ZIPs + .CHECKSUM files, verifies SHA-256, extracts CSVs,
 * and writes a provenance manifest.json.
 *
 * Usage:
 *   bun run research/backtest/download-binance.ts --out /tmp/research-data/binance --months 2024-11,2024-12,2025-01,2025-02
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseOhlcvCsv } from './csv';

export type BinanceMarket = 'spot' | 'futures_um';

export interface ArchiveSpec {
  market: BinanceMarket;
  symbol: string;
  interval: string;
  month: string; // YYYY-MM
}

export function buildBinanceVisionUrl(spec: ArchiveSpec): { zipUrl: string; checksumUrl: string; filename: string } {
  const base = spec.market === 'spot'
    ? `https://data.binance.vision/data/spot/monthly/klines/${spec.symbol}/${spec.interval}`
    : `https://data.binance.vision/data/futures/um/monthly/klines/${spec.symbol}/${spec.interval}`;
  const filename = `${spec.symbol}-${spec.interval}-${spec.month}.zip`;
  return { zipUrl: `${base}/${filename}`, checksumUrl: `${base}/${filename}.CHECKSUM`, filename };
}

export async function downloadAndVerifyArchive(spec: ArchiveSpec, outDir: string) {
  const { zipUrl, checksumUrl, filename } = buildBinanceVisionUrl(spec);
  const dir = join(outDir, spec.market, spec.symbol, spec.interval);
  mkdirSync(dir, { recursive: true });

  const [zipRes, sumRes] = await Promise.all([fetch(zipUrl), fetch(checksumUrl)]);
  if (!zipRes.ok) throw new Error(`HTTP ${zipRes.status} fetching ${zipUrl}`);
  if (!sumRes.ok) throw new Error(`HTTP ${sumRes.status} fetching ${checksumUrl}`);

  const zipBuf = Buffer.from(await zipRes.arrayBuffer());
  const expectedSum = (await sumRes.text()).trim().split(/\s+/)[0].toLowerCase();
  const actualSum = createHash('sha256').update(zipBuf).digest('hex').toLowerCase();
  if (actualSum !== expectedSum) {
    throw new Error(`SHA-256 mismatch for ${filename}: expected ${expectedSum}, got ${actualSum}`);
  }

  const zipPath = join(dir, filename);
  writeFileSync(zipPath, zipBuf);
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', dir]);
  const csvPath = join(dir, filename.replace(/\.zip$/, '.csv'));
  if (!existsSync(csvPath)) throw new Error(`Extracted CSV not found at ${csvPath}`);

  const csvText = await Bun.file(csvPath).text();
  const parsed = parseOhlcvCsv(csvText);
  if (!parsed.ok) throw new Error(`CSV validation failed for ${csvPath}: ${parsed.errors.join('; ')}`);

  return {
    sourceUrl: zipUrl,
    market: spec.market,
    symbol: spec.symbol,
    interval: spec.interval,
    month: spec.month,
    sha256: actualSum,
    checksumVerified: true,
    csvPath,
    provenance: parsed.provenance,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const outDir = getArg('--out', '/tmp/research-data/binance');
  const symbols = getArg('--symbols', 'BTCUSDT,ETHUSDT').split(',');
  const intervals = getArg('--intervals', '1h,15m').split(',');
  const markets = getArg('--markets', 'spot,futures_um').split(',') as BinanceMarket[];
  const months = getArg('--months', '2024-12,2025-01').split(',');

  const manifest: unknown[] = [];
  for (const market of markets) {
    for (const symbol of symbols) {
      for (const interval of intervals) {
        for (const month of months) {
          const entry = await downloadAndVerifyArchive({ market, symbol, interval, month }, outDir);
          manifest.push(entry);
          console.log(`[OK] ${market} ${symbol} ${interval} ${month} (${entry.provenance.rowCount} bars, unit=${entry.provenance.timestampUnit}, sha256=${entry.sha256.slice(0, 12)}...)`);
        }
      }
    }
  }
  const manifestPath = join(outDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify({ generatedAt: new Date().toISOString(), entries: manifest }, null, 2));
  console.log(`Manifest written to ${manifestPath} (${manifest.length} archives verified).`);
}

if (import.meta.main) {
  main().catch(err => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}