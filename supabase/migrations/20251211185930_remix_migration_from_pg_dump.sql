CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "plpgsql" WITH SCHEMA "pg_catalog";
CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: account_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.account_type AS ENUM (
    'paper',
    'live'
);


--
-- Name: batch_close_reason; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.batch_close_reason AS ENUM (
    'tp_hit',
    'stop_hit',
    'manual_take_burst_profit',
    'global_close',
    'error'
);


--
-- Name: batch_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.batch_status AS ENUM (
    'pending',
    'active',
    'closed',
    'stopped'
);


--
-- Name: connection_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.connection_status AS ENUM (
    'connected',
    'error',
    'disconnected'
);


--
-- Name: log_level; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.log_level AS ENUM (
    'info',
    'warn',
    'error'
);


--
-- Name: log_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.log_source AS ENUM (
    'execution',
    'broker',
    'risk',
    'ai',
    'burst'
);


--
-- Name: trade_side; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.trade_side AS ENUM (
    'long',
    'short'
);


--
-- Name: trade_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.trade_status AS ENUM (
    'open',
    'closed',
    'error'
);


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

  -- Create default paper config
  INSERT INTO public.paper_config (user_id, is_running)
  VALUES (NEW.id, false);
  
  RETURN NEW;
END;
$$;


SET default_table_access_method = heap;

--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type public.account_type DEFAULT 'paper'::public.account_type NOT NULL,
    broker_name text DEFAULT 'paper'::text,
    name text NOT NULL,
    base_currency text DEFAULT 'USDT'::text,
    equity numeric DEFAULT 10000,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT true
);


--
-- Name: api_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    status public.connection_status DEFAULT 'disconnected'::public.connection_status,
    broker_base_url text,
    last_checked_at timestamp with time zone
);


--
-- Name: burst_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.burst_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    status public.batch_status DEFAULT 'pending'::public.batch_status,
    symbol text NOT NULL,
    mode_key text DEFAULT 'burst'::text,
    burst_size integer DEFAULT 20,
    total_risk_pct numeric DEFAULT 2.0,
    result_pct numeric,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    reason_closed public.batch_close_reason
);


--
-- Name: equity_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equity_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
    equity numeric NOT NULL,
    day_pnl_pct numeric DEFAULT 0
);


--
-- Name: mode_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mode_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    mode_key text NOT NULL,
    enabled boolean DEFAULT true,
    risk_per_trade_pct numeric DEFAULT 1.0,
    max_daily_loss_pct numeric DEFAULT 5.0,
    max_daily_profit_pct numeric DEFAULT 10.0,
    extra_config jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT mode_configs_mode_key_check CHECK ((mode_key = ANY (ARRAY['sniper'::text, 'quantum'::text, 'burst'::text, 'trend'::text, 'swing'::text, 'news'::text, 'stealth'::text, 'memory'::text])))
);


--
-- Name: paper_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.paper_config (
    user_id uuid NOT NULL,
    risk_config jsonb DEFAULT '{"maxDailyLossPercent": 5, "maxConcurrentRiskPercent": 10}'::jsonb,
    burst_config jsonb DEFAULT '{"size": 20, "dailyProfitTargetPercent": 8}'::jsonb,
    mode_config jsonb DEFAULT '{"enabledModes": ["sniper", "trend"], "modeSettings": {}}'::jsonb,
    market_config jsonb DEFAULT '{"typeFilters": {"forex": true, "index": true, "metal": true, "crypto": true}, "selectedSymbols": ["BTCUSDT", "ETHUSDT"]}'::jsonb,
    trading_halted_for_day boolean DEFAULT false,
    burst_requested boolean DEFAULT false,
    use_ai_reasoning boolean DEFAULT true,
    show_advanced_explanations boolean DEFAULT false,
    broker_api_url text,
    updated_at timestamp with time zone DEFAULT now(),
    is_running boolean DEFAULT false,
    session_started_at timestamp with time zone,
    session_status text DEFAULT 'idle'::text,
    daily_loss_limit_pct numeric DEFAULT 5,
    CONSTRAINT paper_config_session_status_check CHECK ((session_status = ANY (ARRAY['idle'::text, 'running'::text, 'paused'::text, 'stopped'::text])))
);


--
-- Name: paper_positions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.paper_positions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    symbol text NOT NULL,
    mode text NOT NULL,
    side text NOT NULL,
    size numeric NOT NULL,
    entry_price numeric NOT NULL,
    sl numeric,
    tp numeric,
    opened_at timestamp with time zone DEFAULT now(),
    unrealized_pnl numeric DEFAULT 0,
    closed boolean DEFAULT false,
    batch_id text,
    CONSTRAINT paper_positions_side_check CHECK ((side = ANY (ARRAY['long'::text, 'short'::text])))
);


--
-- Name: paper_stats_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.paper_stats_daily (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    trade_date date NOT NULL,
    equity_start numeric DEFAULT 10000 NOT NULL,
    equity_end numeric DEFAULT 10000 NOT NULL,
    pnl numeric DEFAULT 0,
    win_rate numeric DEFAULT 0,
    trades_count integer DEFAULT 0,
    max_drawdown numeric DEFAULT 0
);


--
-- Name: paper_trades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.paper_trades (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    symbol text NOT NULL,
    mode text NOT NULL,
    side text NOT NULL,
    size numeric NOT NULL,
    entry_price numeric NOT NULL,
    exit_price numeric NOT NULL,
    sl numeric,
    tp numeric,
    opened_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone DEFAULT now(),
    realized_pnl numeric NOT NULL,
    reason text,
    session_date date DEFAULT CURRENT_DATE,
    batch_id text,
    CONSTRAINT paper_trades_side_check CHECK ((side = ANY (ARRAY['long'::text, 'short'::text])))
);


--
-- Name: price_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_history (
    id bigint NOT NULL,
    symbol text NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
    bid numeric NOT NULL,
    ask numeric NOT NULL,
    mid numeric NOT NULL,
    timeframe text DEFAULT '1m'::text,
    volatility numeric,
    regime text,
    CONSTRAINT price_history_regime_check CHECK ((regime = ANY (ARRAY['trend'::text, 'range'::text, 'high_vol'::text, 'low_vol'::text])))
);


--
-- Name: price_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.price_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: price_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.price_history_id_seq OWNED BY public.price_history.id;


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: symbols; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.symbols (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    symbol text NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    is_active boolean DEFAULT true,
    spread_estimate numeric DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT symbols_type_check CHECK ((type = ANY (ARRAY['crypto'::text, 'forex'::text, 'index'::text, 'metal'::text])))
);


--
-- Name: system_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    level public.log_level DEFAULT 'info'::public.log_level,
    source public.log_source DEFAULT 'execution'::public.log_source,
    message text NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb
);


--
-- Name: trades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trades (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    mode_key text NOT NULL,
    symbol text NOT NULL,
    side public.trade_side NOT NULL,
    size numeric NOT NULL,
    entry_price numeric NOT NULL,
    exit_price numeric,
    sl_price numeric,
    tp_price numeric,
    status public.trade_status DEFAULT 'open'::public.trade_status,
    pnl numeric,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    extra_meta jsonb DEFAULT '{}'::jsonb
);


--
-- Name: user_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    max_daily_loss_pct numeric DEFAULT 5.0,
    max_concurrent_risk_pct numeric DEFAULT 10.0,
    burst_size integer DEFAULT 20,
    burst_daily_target_pct numeric DEFAULT 8.0,
    use_ai_reasoning boolean DEFAULT true,
    show_advanced_explanations boolean DEFAULT false,
    use_news_api boolean DEFAULT false
);


--
-- Name: price_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_history ALTER COLUMN id SET DEFAULT nextval('public.price_history_id_seq'::regclass);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: api_connections api_connections_account_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_connections
    ADD CONSTRAINT api_connections_account_id_key UNIQUE (account_id);


--
-- Name: api_connections api_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_connections
    ADD CONSTRAINT api_connections_pkey PRIMARY KEY (id);


--
-- Name: burst_batches burst_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.burst_batches
    ADD CONSTRAINT burst_batches_pkey PRIMARY KEY (id);


--
-- Name: equity_snapshots equity_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equity_snapshots
    ADD CONSTRAINT equity_snapshots_pkey PRIMARY KEY (id);


--
-- Name: mode_configs mode_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mode_configs
    ADD CONSTRAINT mode_configs_pkey PRIMARY KEY (id);


--
-- Name: mode_configs mode_configs_user_id_mode_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mode_configs
    ADD CONSTRAINT mode_configs_user_id_mode_key_key UNIQUE (user_id, mode_key);


--
-- Name: paper_config paper_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.paper_config
    ADD CONSTRAINT paper_config_pkey PRIMARY KEY (user_id);


--
-- Name: paper_positions paper_positions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.paper_positions
    ADD CONSTRAINT paper_positions_pkey PRIMARY KEY (id);


--
-- Name: paper_stats_daily paper_stats_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.paper_stats_daily
    ADD CONSTRAINT paper_stats_daily_pkey PRIMARY KEY (id);


--
-- Name: paper_stats_daily paper_stats_daily_user_date_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.paper_stats_daily
    ADD CONSTRAINT paper_stats_daily_user_date_unique UNIQUE (user_id, trade_date);


--
-- Name: paper_stats_daily paper_stats_daily_user_id_trade_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.paper_stats_daily
    ADD CONSTRAINT paper_stats_daily_user_id_trade_date_key UNIQUE (user_id, trade_date);


--
-- Name: paper_trades paper_trades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.paper_trades
    ADD CONSTRAINT paper_trades_pkey PRIMARY KEY (id);


--
-- Name: price_history price_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_history
    ADD CONSTRAINT price_history_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_key UNIQUE (user_id);


--
-- Name: symbols symbols_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.symbols
    ADD CONSTRAINT symbols_pkey PRIMARY KEY (id);


--
-- Name: symbols symbols_symbol_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.symbols
    ADD CONSTRAINT symbols_symbol_key UNIQUE (symbol);


--
-- Name: system_logs system_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_logs
    ADD CONSTRAINT system_logs_pkey PRIMARY KEY (id);


--
-- Name: trades trades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_pkey PRIMARY KEY (id);


--
-- Name: user_settings user_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_pkey PRIMARY KEY (id);


--
-- Name: user_settings user_settings_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_user_id_key UNIQUE (user_id);


--
-- Name: idx_paper_stats_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_paper_stats_user_date ON public.paper_stats_daily USING btree (user_id, trade_date DESC);


--
-- Name: idx_price_history_symbol; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_history_symbol ON public.price_history USING btree (symbol);


--
-- Name: idx_price_history_symbol_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_history_symbol_ts ON public.price_history USING btree (symbol, "timestamp" DESC);


--
-- Name: idx_price_history_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_history_timestamp ON public.price_history USING btree ("timestamp" DESC);


--
-- Name: accounts accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: api_connections api_connections_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_connections
    ADD CONSTRAINT api_connections_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: burst_batches burst_batches_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.burst_batches
    ADD CONSTRAINT burst_batches_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: equity_snapshots equity_snapshots_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equity_snapshots
    ADD CONSTRAINT equity_snapshots_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: mode_configs mode_configs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mode_configs
    ADD CONSTRAINT mode_configs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: system_logs system_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_logs
    ADD CONSTRAINT system_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: trades trades_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: user_settings user_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: price_history Price history insertable by service role; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Price history insertable by service role" ON public.price_history AS RESTRICTIVE FOR INSERT TO service_role WITH CHECK (true);


--
-- Name: price_history Price history readable by authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Price history readable by authenticated" ON public.price_history FOR SELECT TO authenticated USING (true);


--
-- Name: symbols Symbols are readable by all authenticated users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Symbols are readable by all authenticated users" ON public.symbols FOR SELECT TO authenticated USING (true);


--
-- Name: accounts Users can create own accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create own accounts" ON public.accounts FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: burst_batches Users can create own burst batches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create own burst batches" ON public.burst_batches FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.accounts
  WHERE ((accounts.id = burst_batches.account_id) AND (accounts.user_id = auth.uid())))));


--
-- Name: equity_snapshots Users can create own equity snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create own equity snapshots" ON public.equity_snapshots FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.accounts
  WHERE ((accounts.id = equity_snapshots.account_id) AND (accounts.user_id = auth.uid())))));


--
-- Name: system_logs Users can create own logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create own logs" ON public.system_logs FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: mode_configs Users can create own mode configs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create own mode configs" ON public.mode_configs FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: paper_config Users can create own paper config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create own paper config" ON public.paper_config FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: paper_positions Users can create own paper positions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create own paper positions" ON public.paper_positions FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: paper_stats_daily Users can create own paper stats; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create own paper stats" ON public.paper_stats_daily FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: paper_trades Users can create own paper trades; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create own paper trades" ON public.paper_trades FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: user_settings Users can create own settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create own settings" ON public.user_settings FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: trades Users can create own trades; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create own trades" ON public.trades FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.accounts
  WHERE ((accounts.id = trades.account_id) AND (accounts.user_id = auth.uid())))));


--
-- Name: accounts Users can delete own accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own accounts" ON public.accounts FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: profiles Users can insert own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: api_connections Users can manage own api connections; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage own api connections" ON public.api_connections USING ((EXISTS ( SELECT 1
   FROM public.accounts
  WHERE ((accounts.id = api_connections.account_id) AND (accounts.user_id = auth.uid())))));


--
-- Name: accounts Users can update own accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own accounts" ON public.accounts FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: burst_batches Users can update own burst batches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own burst batches" ON public.burst_batches FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.accounts
  WHERE ((accounts.id = burst_batches.account_id) AND (accounts.user_id = auth.uid())))));


--
-- Name: mode_configs Users can update own mode configs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own mode configs" ON public.mode_configs FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: paper_config Users can update own paper config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own paper config" ON public.paper_config FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: paper_positions Users can update own paper positions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own paper positions" ON public.paper_positions FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: paper_stats_daily Users can update own paper stats; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own paper stats" ON public.paper_stats_daily FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: profiles Users can update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: user_settings Users can update own settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own settings" ON public.user_settings FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: trades Users can update own trades; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own trades" ON public.trades FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.accounts
  WHERE ((accounts.id = trades.account_id) AND (accounts.user_id = auth.uid())))));


--
-- Name: accounts Users can view own accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own accounts" ON public.accounts FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: api_connections Users can view own api connections; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own api connections" ON public.api_connections FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.accounts
  WHERE ((accounts.id = api_connections.account_id) AND (accounts.user_id = auth.uid())))));


--
-- Name: burst_batches Users can view own burst batches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own burst batches" ON public.burst_batches FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.accounts
  WHERE ((accounts.id = burst_batches.account_id) AND (accounts.user_id = auth.uid())))));


--
-- Name: equity_snapshots Users can view own equity snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own equity snapshots" ON public.equity_snapshots FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.accounts
  WHERE ((accounts.id = equity_snapshots.account_id) AND (accounts.user_id = auth.uid())))));


--
-- Name: system_logs Users can view own logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own logs" ON public.system_logs FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: mode_configs Users can view own mode configs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own mode configs" ON public.mode_configs FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: paper_config Users can view own paper config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own paper config" ON public.paper_config FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: paper_positions Users can view own paper positions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own paper positions" ON public.paper_positions FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: paper_stats_daily Users can view own paper stats; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own paper stats" ON public.paper_stats_daily FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: paper_trades Users can view own paper trades; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own paper trades" ON public.paper_trades FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: profiles Users can view own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: user_settings Users can view own settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own settings" ON public.user_settings FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: trades Users can view own trades; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own trades" ON public.trades FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.accounts
  WHERE ((accounts.id = trades.account_id) AND (accounts.user_id = auth.uid())))));


--
-- Name: accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: api_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.api_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: burst_batches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.burst_batches ENABLE ROW LEVEL SECURITY;

--
-- Name: equity_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.equity_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: mode_configs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mode_configs ENABLE ROW LEVEL SECURITY;

--
-- Name: paper_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.paper_config ENABLE ROW LEVEL SECURITY;

--
-- Name: paper_positions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.paper_positions ENABLE ROW LEVEL SECURITY;

--
-- Name: paper_stats_daily; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.paper_stats_daily ENABLE ROW LEVEL SECURITY;

--
-- Name: paper_trades; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.paper_trades ENABLE ROW LEVEL SECURITY;

--
-- Name: price_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: symbols; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.symbols ENABLE ROW LEVEL SECURITY;

--
-- Name: system_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: trades; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;

--
-- Name: user_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--


