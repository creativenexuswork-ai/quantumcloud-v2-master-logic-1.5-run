// ============= PAPER RESTART — Unlock & Reset Session =============
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get auth token
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ ok: false, error: 'No authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Get user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;
    console.log(`[RESTART] User ${userId} requesting restart/unlock`);

    // Get current equity from account for resetting baseline
    const { data: account } = await supabase
      .from('accounts')
      .select('equity')
      .eq('user_id', userId)
      .eq('type', 'paper')
      .single();

    const currentEquity = account?.equity || 10000;

    // Update paper_config to reset session state
    const { error: configError } = await supabase
      .from('paper_config')
      .update({
        is_running: false,
        session_status: 'idle',
        session_started_at: null,
        burst_requested: false,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    if (configError) {
      console.error('[RESTART] Config update error:', configError);
      return new Response(
        JSON.stringify({ ok: false, error: 'Failed to reset config' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Reset today's stats in paper_stats_daily
    const today = new Date().toISOString().split('T')[0];
    const { data: existingStats } = await supabase
      .from('paper_stats_daily')
      .select('id')
      .eq('user_id', userId)
      .eq('trade_date', today)
      .single();

    if (existingStats) {
      // Update existing stats for today
      await supabase
        .from('paper_stats_daily')
        .update({
          equity_start: currentEquity,
          equity_end: currentEquity,
          pnl: 0,
          win_rate: 0,
          trades_count: 0,
          max_drawdown: 0,
        })
        .eq('id', existingStats.id);
    } else {
      // Create new stats entry for today
      await supabase
        .from('paper_stats_daily')
        .insert({
          user_id: userId,
          trade_date: today,
          equity_start: currentEquity,
          equity_end: currentEquity,
          pnl: 0,
          win_rate: 0,
          trades_count: 0,
          max_drawdown: 0,
        });
    }

    // Log the restart action
    await supabase
      .from('system_logs')
      .insert({
        user_id: userId,
        level: 'info',
        source: 'execution',
        message: 'SYSTEM: Restart/Unlock executed',
        meta: {
          action: 'restart',
          equity_baseline: currentEquity,
          timestamp: new Date().toISOString(),
        },
      });

    console.log(`[RESTART] Success for user ${userId}, equity baseline: ${currentEquity}`);

    return new Response(
      JSON.stringify({
        ok: true,
        userId,
        reset: true,
        equityBaseline: currentEquity,
        message: 'Session reset complete. Press Start to begin trading.',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    const error = err as Error;
    console.error('[RESTART] Error:', error);
    return new Response(
      JSON.stringify({ ok: false, error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
