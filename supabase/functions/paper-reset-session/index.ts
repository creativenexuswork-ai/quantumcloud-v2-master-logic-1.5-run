import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get auth token from request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ ok: false, error: 'No authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create user client to get user ID from JWT
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      console.error('[SESSION_RESET] Auth error:', userError);
      return new Response(
        JSON.stringify({ ok: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;
    console.log('[SESSION_RESET] Starting reset for user:', userId);

    // Create service role client for privileged operations
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // 1) Reset paper_config session state
    const { error: configError } = await serviceClient
      .from('paper_config')
      .update({
        is_running: false,
        session_status: 'idle',
        burst_requested: false,
        session_started_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    if (configError) {
      console.error('[SESSION_RESET] Config update error:', configError);
      return new Response(
        JSON.stringify({ ok: false, error: 'Failed to reset config' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2) Archive today's trades by shifting session_date back one day
    // This prevents them from affecting burst locks or daily stats
    const today = new Date().toISOString().split('T')[0];
    const { error: tradesError } = await serviceClient
      .from('paper_trades')
      .update({
        session_date: new Date(Date.now() - 86400000).toISOString().split('T')[0], // Yesterday
      })
      .eq('user_id', userId)
      .eq('session_date', today);

    if (tradesError) {
      console.warn('[SESSION_RESET] Trades archive warning:', tradesError);
      // Non-fatal, continue
    }

    // 3) Log the reset
    await serviceClient.from('system_logs').insert({
      user_id: userId,
      level: 'info',
      source: 'execution',
      message: 'SESSION: Reset - clean slate for new trading session',
    });

    console.log('[SESSION_RESET] Complete for user:', userId);

    return new Response(
      JSON.stringify({ ok: true, reset: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[SESSION_RESET] Error:', error);
    return new Response(
      JSON.stringify({ ok: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
