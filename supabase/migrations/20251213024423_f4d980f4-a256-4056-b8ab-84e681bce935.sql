-- Drop the daily halt column entirely
ALTER TABLE paper_config DROP COLUMN IF EXISTS trading_halted_for_day;

-- Update handle_new_user() to use correct symbols (BTCUSD/ETHUSD, not BTCUSDT/ETHUSDT)
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, email)
  VALUES (NEW.id, NEW.email);
  
  -- Create default paper account
  INSERT INTO public.accounts (user_id, type, name, broker_name, base_currency, equity)
  VALUES (NEW.id, 'paper', 'Paper Account', 'paper', 'USDT', 10000);
  
  -- Create default mode configs
  INSERT INTO public.mode_configs (user_id, mode_key, risk_per_trade_pct, max_daily_loss_pct, max_daily_profit_pct, extra_config)
  VALUES 
    (NEW.id, 'sniper', 0.5, 3, 8, '{"timeframes": ["15m", "1h"], "min_confidence": 0.8}'),
    (NEW.id, 'quantum', 1.0, 5, 10, '{"adaptive": true}'),
    (NEW.id, 'burst', 0.1, 2, 8, '{"burst_size": 20, "intensity": "high"}'),
    (NEW.id, 'trend', 1.0, 5, 10, '{"ema_periods": [20, 50]}'),
    (NEW.id, 'swing', 2.0, 5, 15, '{"timeframes": ["4h", "1d"]}'),
    (NEW.id, 'news', 0.5, 3, 8, '{"filter_high_impact": true}'),
    (NEW.id, 'stealth', 0.5, 3, 6, '{"randomize_timing": true}'),
    (NEW.id, 'memory', 1.0, 5, 10, '{"lookback_trades": 100}');
  
  -- Create default user settings
  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id);

  -- Create default paper config with CORRECT symbols (BTCUSD/ETHUSD)
  INSERT INTO public.paper_config (user_id, is_running, market_config)
  VALUES (NEW.id, false, '{"typeFilters": {"crypto": true}, "selectedSymbols": ["BTCUSD", "ETHUSD"]}'::jsonb);
  
  RETURN NEW;
END;
$function$;