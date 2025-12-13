import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid auth' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = user.id;
    const today = new Date().toISOString().split('T')[0];

    // Get or create paper config
    let { data: config } = await supabase
      .from('paper_config')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (!config) {
      const { data: newConfig } = await supabase
        .from('paper_config')
        .insert({
          user_id: userId,
          risk_config: { maxDailyLossPercent: 5, maxConcurrentRiskPercent: 10 },
          burst_config: { size: 20, dailyProfitTargetPercent: 8 },
          mode_config: { enabledModes: ['trend'], modeSettings: {} },
          market_config: { selectedSymbols: ['BTCUSD', 'ETHUSD'], typeFilters: { crypto: true } },
          is_running: false,
        })
        .select()
        .single();
      config = newConfig;
    }

    // Get positions
    const { data: positions } = await supabase
      .from('paper_positions')
      .select('*')
      .eq('user_id', userId)
      .eq('closed', false);

    // Get today's trades
    const { data: todayTrades } = await supabase
      .from('paper_trades')
      .select('*')
      .eq('user_id', userId)
      .eq('session_date', today);

    // Get account
    const { data: account } = await supabase
      .from('accounts')
      .select('equity')
      .eq('user_id', userId)
      .eq('type', 'paper')
      .maybeSingle();

    // Get historical stats
    const { data: historicalStats } = await supabase
      .from('paper_stats_daily')
      .select('*')
      .eq('user_id', userId)
      .order('trade_date', { ascending: true })
      .limit(30);

    // Get symbols
    const { data: symbols } = await supabase
      .from('symbols')
      .select('*')
      .eq('is_active', true);

    // Get recent system logs
    const { data: logs } = await supabase
      .from('system_logs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    // Get daily stats for starting equity
    const { data: dailyStats } = await supabase
      .from('paper_stats_daily')
      .select('equity_start')
      .eq('user_id', userId)
      .eq('trade_date', today)
      .maybeSingle();

    const startingEquity = dailyStats?.equity_start ?? account?.equity ?? 10000;
    const realizedPnl = (todayTrades || []).reduce((sum: number, t: any) => sum + Number(t.realized_pnl), 0);
    const unrealizedPnl = (positions || []).reduce((sum: number, p: any) => sum + Number(p.unrealized_pnl || 0), 0);
    const todayPnl = realizedPnl + unrealizedPnl;
    const todayPnlPercent = startingEquity > 0 ? (todayPnl / startingEquity) * 100 : 0;

    const closedCount = (todayTrades || []).length;
    const wins = (todayTrades || []).filter((t: any) => Number(t.realized_pnl) > 0).length;
    const winRate = closedCount > 0 ? (wins / closedCount) * 100 : 0;

    // Calculate avg R:R
    const profitTrades = (todayTrades || []).filter((t: any) => Number(t.realized_pnl) > 0);
    const lossTrades = (todayTrades || []).filter((t: any) => Number(t.realized_pnl) < 0);
    const avgWin = profitTrades.length > 0 
      ? profitTrades.reduce((s: number, t: any) => s + Number(t.realized_pnl), 0) / profitTrades.length 
      : 0;
    const avgLoss = lossTrades.length > 0 
      ? Math.abs(lossTrades.reduce((s: number, t: any) => s + Number(t.realized_pnl), 0) / lossTrades.length) 
      : 1;
    const avgRR = avgLoss > 0 ? avgWin / avgLoss : 0;

    const burstTrades = (todayTrades || []).filter((t: any) => t.mode === 'burst');
    const burstPnl = burstTrades.reduce((sum: number, t: any) => sum + Number(t.realized_pnl), 0);
    const burstPnlPercent = startingEquity > 0 ? (burstPnl / startingEquity) * 100 : 0;

    const burstPositions = (positions || []).filter((p: any) => p.mode === 'burst');
    const burstConfig = config?.burst_config || { dailyProfitTargetPercent: 8 };
    const burstStatus = burstPositions.length > 0 
      ? 'running' 
      : burstPnlPercent >= burstConfig.dailyProfitTargetPercent ? 'locked' : 'idle';

    const sessionStatus = config?.session_status || 'idle';

    const stats = {
      equity: startingEquity + todayPnl,
      todayPnl,
      todayPnlPercent,
      winRate,
      avgRR,
      tradesToday: closedCount,
      maxDrawdown: 0,
      openPositionsCount: (positions || []).length,
      burstPnlToday: burstPnlPercent,
      burstsToday: new Set(burstTrades.map((t: any) => t.batch_id).filter(Boolean)).size,
      burstStatus,
    };

    return new Response(JSON.stringify({
      stats,
      positions,
      trades: todayTrades,
      historicalStats,
      symbols,
      logs,
      config: config ? {
        risk_config: config.risk_config,
        burst_config: config.burst_config,
        mode_config: config.mode_config,
        market_config: config.market_config,
        burst_requested: config.burst_requested,
        use_ai_reasoning: config.use_ai_reasoning,
        show_advanced_explanations: config.show_advanced_explanations,
        is_running: config.is_running,
        session_status: config.session_status,
      } : null,
      halted: false,
      sessionStatus,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Paper stats error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
