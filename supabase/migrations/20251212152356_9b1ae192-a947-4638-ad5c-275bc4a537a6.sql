-- Set safe default for new paper_config rows with correct symbols
ALTER TABLE paper_config
ALTER COLUMN market_config
SET DEFAULT '{
  "selectedSymbols": ["BTCUSD","ETHUSD"],
  "typeFilters": {
    "crypto": true,
    "forex": true,
    "index": true,
    "metal": true
  }
}'::jsonb;