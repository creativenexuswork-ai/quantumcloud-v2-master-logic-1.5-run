// ============= PRICE FEED v2.0 — Finnhub Quote API Only =============
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============= TYPES =============
interface FinnhubQuote {
  c: number;  // Current price
  d: number;  // Change
  dp: number; // Percent change
  h: number;  // High price of the day
  l: number;  // Low price of the day
  o: number;  // Open price of the day
  pc: number; // Previous close price
  t: number;  // Timestamp
}

interface PriceTick {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  volatility: number;
  regime: string;
  timestamp: string;
  timeframe: string;
  source: string;
}

// ============= FINNHUB SYMBOL MAPPING =============
// Maps our internal symbols to Finnhub format
const FINNHUB_SYMBOL_MAP: Record<string, string> = {
  'BTCUSD': 'BINANCE:BTCUSDT',
  'BTC/USD': 'BINANCE:BTCUSDT',
  'ETHUSD': 'BINANCE:ETHUSDT',
  'ETH/USD': 'BINANCE:ETHUSDT',
};

// ============= SPREAD SIMULATION =============
function applySpread(mid: number): { bid: number; ask: number } {
  // Crypto spread: 0.02% - 0.10%
  const spreadPercent = 0.0002 + Math.random() * 0.0008;
  const halfSpread = mid * spreadPercent / 2;
  return {
    bid: mid - halfSpread,
    ask: mid + halfSpread,
  };
}

// ============= FINNHUB QUOTE FETCH =============
async function fetchFinnhubQuote(symbol: string, apiKey: string): Promise<PriceTick | null> {
  // Normalize symbol
  const normalizedSymbol = symbol.replace('/', '');
  const finnhubSymbol = FINNHUB_SYMBOL_MAP[normalizedSymbol] || FINNHUB_SYMBOL_MAP[symbol];
  
  if (!finnhubSymbol) {
    console.error(`[PRICE_FEED] Unknown symbol: ${symbol}`);
    return null;
  }
  
  const endpoint = `https://finnhub.io/api/v1/quote?symbol=${finnhubSymbol}&token=${apiKey}`;
  
  console.log(`[PRICE_FEED] Fetching quote for ${symbol} (${finnhubSymbol})`);
  
  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      console.error(`[PRICE_FEED] HTTP error: ${response.status}`);
      return null;
    }
    
    const data: FinnhubQuote = await response.json();
    
    // Finnhub returns zeros when no data
    if (!data.c || data.c === 0) {
      console.error(`[PRICE_FEED] No quote data for ${symbol}: ${JSON.stringify(data)}`);
      return null;
    }
    
    console.log(`[PRICE_FEED] Got quote for ${symbol}: price=${data.c}, high=${data.h}, low=${data.l}`);
    
    const mid = data.c;
    const { bid, ask } = applySpread(mid);
    
    // Calculate volatility from daily range
    let volatility = 0.5;
    if (data.h > 0 && data.l > 0) {
      const range = (data.h - data.l) / mid;
      volatility = Math.min(10, Math.max(0.1, range * 100));
    }
    
    // Determine regime from daily movement
    let regime = 'range';
    if (data.dp > 1.5) regime = 'trend';
    else if (data.dp < -1.5) regime = 'trend';
    if (volatility > 2) regime = 'high_vol';
    if (volatility < 0.3) regime = 'low_vol';
    
    return {
      symbol: normalizedSymbol,
      bid,
      ask,
      mid,
      volatility,
      regime,
      timestamp: new Date().toISOString(),
      timeframe: '1m',
      source: 'finnhub',
    };
  } catch (error) {
    console.error(`[PRICE_FEED] Error fetching ${symbol}:`, error);
    return null;
  }
}

// ============= MAIN HANDLER =============
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('FINNHUB_API_KEY');
    if (!apiKey) {
      console.error('[PRICE_FEED] FINNHUB_API_KEY not configured');
      return new Response(JSON.stringify({ 
        error: 'API key not configured',
        shouldPauseTrading: true,
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse request body for symbols
    let requestedSymbols: string[] = [];
    
    try {
      const body = await req.json();
      requestedSymbols = body.symbols || [];
    } catch {
      // No body - use defaults from DB
    }

    // Get active symbols from database if not specified
    if (requestedSymbols.length === 0) {
      const { data: dbSymbols } = await supabase
        .from('symbols')
        .select('symbol')
        .eq('is_active', true)
        .eq('type', 'crypto'); // Only crypto symbols
      
      if (dbSymbols && dbSymbols.length > 0) {
        requestedSymbols = dbSymbols.map(s => s.symbol);
      } else {
        // Fallback to default crypto symbols
        requestedSymbols = ['BTCUSD', 'ETHUSD'];
      }
    }
    
    console.log(`[PRICE_FEED] Fetching ${requestedSymbols.length} symbols: ${requestedSymbols.join(', ')}`);
    
    const ticks: Record<string, PriceTick> = {};
    const errors: Record<string, string> = {};
    const ticksToInsert: any[] = [];

    // Fetch each symbol sequentially (respecting rate limits)
    for (const symbol of requestedSymbols) {
      const tick = await fetchFinnhubQuote(symbol, apiKey);
      
      if (tick) {
        ticks[tick.symbol] = tick;
        ticksToInsert.push({
          symbol: tick.symbol,
          bid: tick.bid,
          ask: tick.ask,
          mid: tick.mid,
          volatility: tick.volatility,
          regime: tick.regime,
          timestamp: tick.timestamp,
          timeframe: tick.timeframe,
        });
      } else {
        errors[symbol] = 'Failed to fetch quote';
      }
      
      // Small delay between requests to respect rate limits
      if (requestedSymbols.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Insert into price_history
    if (ticksToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('price_history')
        .insert(ticksToInsert);
      
      if (insertError) {
        console.error('[PRICE_FEED] Error inserting price history:', insertError);
      } else {
        console.log(`[PRICE_FEED] Inserted ${ticksToInsert.length} ticks into price_history`);
      }
    }

    // If no data at all, return error
    if (Object.keys(ticks).length === 0) {
      return new Response(JSON.stringify({ 
        ticks: {}, 
        timestamp: new Date().toISOString(),
        source: 'NO_DATA',
        error: 'Failed to fetch any quotes',
        errors,
        shouldPauseTrading: true,
      }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ 
      ticks, 
      timestamp: new Date().toISOString(),
      source: 'finnhub',
      errors: Object.keys(errors).length > 0 ? errors : undefined,
      shouldPauseTrading: false,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[PRICE_FEED] Unexpected error:', error);
    return new Response(JSON.stringify({ 
      error: 'Internal server error',
      shouldPauseTrading: true,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
