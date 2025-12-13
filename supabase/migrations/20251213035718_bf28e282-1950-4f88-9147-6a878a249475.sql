-- Fix legacy BTCUSDT / ETHUSDT symbols in paper_config.market_config.selectedSymbols
-- This is idempotent and only touches rows that actually contain the bad tokens
UPDATE paper_config
SET market_config =
  jsonb_set(
    market_config,
    '{selectedSymbols}',
    (
      SELECT jsonb_agg(
        CASE
          WHEN sym = 'BTCUSDT' THEN to_jsonb('BTCUSD'::text)
          WHEN sym = 'ETHUSDT' THEN to_jsonb('ETHUSD'::text)
          ELSE to_jsonb(sym)
        END
      )
      FROM jsonb_array_elements_text(COALESCE(market_config->'selectedSymbols','[]'::jsonb)) AS sym
    ),
    true
  )
WHERE
  (market_config->'selectedSymbols')::text LIKE '%BTCUSDT%'
  OR (market_config->'selectedSymbols')::text LIKE '%ETHUSDT%';