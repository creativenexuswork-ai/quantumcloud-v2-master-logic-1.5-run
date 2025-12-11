-- Fix default symbols for future accounts
ALTER TABLE paper_config
ALTER COLUMN market_config
SET DEFAULT '{"typeFilters": {"crypto": true}, "selectedSymbols": ["BTCUSD", "ETHUSD"]}'::jsonb;