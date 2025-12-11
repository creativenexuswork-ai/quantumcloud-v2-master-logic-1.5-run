export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          base_currency: string | null
          broker_name: string | null
          created_at: string
          equity: number | null
          id: string
          is_active: boolean | null
          name: string
          type: Database["public"]["Enums"]["account_type"]
          user_id: string
        }
        Insert: {
          base_currency?: string | null
          broker_name?: string | null
          created_at?: string
          equity?: number | null
          id?: string
          is_active?: boolean | null
          name: string
          type?: Database["public"]["Enums"]["account_type"]
          user_id: string
        }
        Update: {
          base_currency?: string | null
          broker_name?: string | null
          created_at?: string
          equity?: number | null
          id?: string
          is_active?: boolean | null
          name?: string
          type?: Database["public"]["Enums"]["account_type"]
          user_id?: string
        }
        Relationships: []
      }
      api_connections: {
        Row: {
          account_id: string
          broker_base_url: string | null
          id: string
          last_checked_at: string | null
          status: Database["public"]["Enums"]["connection_status"] | null
        }
        Insert: {
          account_id: string
          broker_base_url?: string | null
          id?: string
          last_checked_at?: string | null
          status?: Database["public"]["Enums"]["connection_status"] | null
        }
        Update: {
          account_id?: string
          broker_base_url?: string | null
          id?: string
          last_checked_at?: string | null
          status?: Database["public"]["Enums"]["connection_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "api_connections_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      burst_batches: {
        Row: {
          account_id: string
          burst_size: number | null
          closed_at: string | null
          id: string
          mode_key: string | null
          opened_at: string
          reason_closed:
            | Database["public"]["Enums"]["batch_close_reason"]
            | null
          result_pct: number | null
          status: Database["public"]["Enums"]["batch_status"] | null
          symbol: string
          total_risk_pct: number | null
        }
        Insert: {
          account_id: string
          burst_size?: number | null
          closed_at?: string | null
          id?: string
          mode_key?: string | null
          opened_at?: string
          reason_closed?:
            | Database["public"]["Enums"]["batch_close_reason"]
            | null
          result_pct?: number | null
          status?: Database["public"]["Enums"]["batch_status"] | null
          symbol: string
          total_risk_pct?: number | null
        }
        Update: {
          account_id?: string
          burst_size?: number | null
          closed_at?: string | null
          id?: string
          mode_key?: string | null
          opened_at?: string
          reason_closed?:
            | Database["public"]["Enums"]["batch_close_reason"]
            | null
          result_pct?: number | null
          status?: Database["public"]["Enums"]["batch_status"] | null
          symbol?: string
          total_risk_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "burst_batches_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      equity_snapshots: {
        Row: {
          account_id: string
          day_pnl_pct: number | null
          equity: number
          id: string
          timestamp: string
        }
        Insert: {
          account_id: string
          day_pnl_pct?: number | null
          equity: number
          id?: string
          timestamp?: string
        }
        Update: {
          account_id?: string
          day_pnl_pct?: number | null
          equity?: number
          id?: string
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "equity_snapshots_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      mode_configs: {
        Row: {
          enabled: boolean | null
          extra_config: Json | null
          id: string
          max_daily_loss_pct: number | null
          max_daily_profit_pct: number | null
          mode_key: string
          risk_per_trade_pct: number | null
          user_id: string
        }
        Insert: {
          enabled?: boolean | null
          extra_config?: Json | null
          id?: string
          max_daily_loss_pct?: number | null
          max_daily_profit_pct?: number | null
          mode_key: string
          risk_per_trade_pct?: number | null
          user_id: string
        }
        Update: {
          enabled?: boolean | null
          extra_config?: Json | null
          id?: string
          max_daily_loss_pct?: number | null
          max_daily_profit_pct?: number | null
          mode_key?: string
          risk_per_trade_pct?: number | null
          user_id?: string
        }
        Relationships: []
      }
      paper_config: {
        Row: {
          broker_api_url: string | null
          burst_config: Json | null
          burst_requested: boolean | null
          daily_loss_limit_pct: number | null
          is_running: boolean | null
          market_config: Json | null
          mode_config: Json | null
          risk_config: Json | null
          session_started_at: string | null
          session_status: string | null
          show_advanced_explanations: boolean | null
          trading_halted_for_day: boolean | null
          updated_at: string | null
          use_ai_reasoning: boolean | null
          user_id: string
        }
        Insert: {
          broker_api_url?: string | null
          burst_config?: Json | null
          burst_requested?: boolean | null
          daily_loss_limit_pct?: number | null
          is_running?: boolean | null
          market_config?: Json | null
          mode_config?: Json | null
          risk_config?: Json | null
          session_started_at?: string | null
          session_status?: string | null
          show_advanced_explanations?: boolean | null
          trading_halted_for_day?: boolean | null
          updated_at?: string | null
          use_ai_reasoning?: boolean | null
          user_id: string
        }
        Update: {
          broker_api_url?: string | null
          burst_config?: Json | null
          burst_requested?: boolean | null
          daily_loss_limit_pct?: number | null
          is_running?: boolean | null
          market_config?: Json | null
          mode_config?: Json | null
          risk_config?: Json | null
          session_started_at?: string | null
          session_status?: string | null
          show_advanced_explanations?: boolean | null
          trading_halted_for_day?: boolean | null
          updated_at?: string | null
          use_ai_reasoning?: boolean | null
          user_id?: string
        }
        Relationships: []
      }
      paper_positions: {
        Row: {
          batch_id: string | null
          closed: boolean | null
          entry_price: number
          id: string
          mode: string
          opened_at: string | null
          side: string
          size: number
          sl: number | null
          symbol: string
          tp: number | null
          unrealized_pnl: number | null
          user_id: string
        }
        Insert: {
          batch_id?: string | null
          closed?: boolean | null
          entry_price: number
          id?: string
          mode: string
          opened_at?: string | null
          side: string
          size: number
          sl?: number | null
          symbol: string
          tp?: number | null
          unrealized_pnl?: number | null
          user_id: string
        }
        Update: {
          batch_id?: string | null
          closed?: boolean | null
          entry_price?: number
          id?: string
          mode?: string
          opened_at?: string | null
          side?: string
          size?: number
          sl?: number | null
          symbol?: string
          tp?: number | null
          unrealized_pnl?: number | null
          user_id?: string
        }
        Relationships: []
      }
      paper_stats_daily: {
        Row: {
          equity_end: number
          equity_start: number
          id: string
          max_drawdown: number | null
          pnl: number | null
          trade_date: string
          trades_count: number | null
          user_id: string
          win_rate: number | null
        }
        Insert: {
          equity_end?: number
          equity_start?: number
          id?: string
          max_drawdown?: number | null
          pnl?: number | null
          trade_date: string
          trades_count?: number | null
          user_id: string
          win_rate?: number | null
        }
        Update: {
          equity_end?: number
          equity_start?: number
          id?: string
          max_drawdown?: number | null
          pnl?: number | null
          trade_date?: string
          trades_count?: number | null
          user_id?: string
          win_rate?: number | null
        }
        Relationships: []
      }
      paper_trades: {
        Row: {
          batch_id: string | null
          closed_at: string | null
          entry_price: number
          exit_price: number
          id: string
          mode: string
          opened_at: string
          realized_pnl: number
          reason: string | null
          session_date: string | null
          side: string
          size: number
          sl: number | null
          symbol: string
          tp: number | null
          user_id: string
        }
        Insert: {
          batch_id?: string | null
          closed_at?: string | null
          entry_price: number
          exit_price: number
          id?: string
          mode: string
          opened_at: string
          realized_pnl: number
          reason?: string | null
          session_date?: string | null
          side: string
          size: number
          sl?: number | null
          symbol: string
          tp?: number | null
          user_id: string
        }
        Update: {
          batch_id?: string | null
          closed_at?: string | null
          entry_price?: number
          exit_price?: number
          id?: string
          mode?: string
          opened_at?: string
          realized_pnl?: number
          reason?: string | null
          session_date?: string | null
          side?: string
          size?: number
          sl?: number | null
          symbol?: string
          tp?: number | null
          user_id?: string
        }
        Relationships: []
      }
      price_history: {
        Row: {
          ask: number
          bid: number
          id: number
          mid: number
          regime: string | null
          symbol: string
          timeframe: string | null
          timestamp: string
          volatility: number | null
        }
        Insert: {
          ask: number
          bid: number
          id?: number
          mid: number
          regime?: string | null
          symbol: string
          timeframe?: string | null
          timestamp?: string
          volatility?: number | null
        }
        Update: {
          ask?: number
          bid?: number
          id?: number
          mid?: number
          regime?: string | null
          symbol?: string
          timeframe?: string | null
          timestamp?: string
          volatility?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      symbols: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          spread_estimate: number | null
          symbol: string
          type: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          spread_estimate?: number | null
          symbol: string
          type: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          spread_estimate?: number | null
          symbol?: string
          type?: string
        }
        Relationships: []
      }
      system_logs: {
        Row: {
          created_at: string
          id: string
          level: Database["public"]["Enums"]["log_level"] | null
          message: string
          meta: Json | null
          source: Database["public"]["Enums"]["log_source"] | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          level?: Database["public"]["Enums"]["log_level"] | null
          message: string
          meta?: Json | null
          source?: Database["public"]["Enums"]["log_source"] | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          level?: Database["public"]["Enums"]["log_level"] | null
          message?: string
          meta?: Json | null
          source?: Database["public"]["Enums"]["log_source"] | null
          user_id?: string | null
        }
        Relationships: []
      }
      trades: {
        Row: {
          account_id: string
          closed_at: string | null
          entry_price: number
          exit_price: number | null
          extra_meta: Json | null
          id: string
          mode_key: string
          opened_at: string
          pnl: number | null
          side: Database["public"]["Enums"]["trade_side"]
          size: number
          sl_price: number | null
          status: Database["public"]["Enums"]["trade_status"] | null
          symbol: string
          tp_price: number | null
        }
        Insert: {
          account_id: string
          closed_at?: string | null
          entry_price: number
          exit_price?: number | null
          extra_meta?: Json | null
          id?: string
          mode_key: string
          opened_at?: string
          pnl?: number | null
          side: Database["public"]["Enums"]["trade_side"]
          size: number
          sl_price?: number | null
          status?: Database["public"]["Enums"]["trade_status"] | null
          symbol: string
          tp_price?: number | null
        }
        Update: {
          account_id?: string
          closed_at?: string | null
          entry_price?: number
          exit_price?: number | null
          extra_meta?: Json | null
          id?: string
          mode_key?: string
          opened_at?: string
          pnl?: number | null
          side?: Database["public"]["Enums"]["trade_side"]
          size?: number
          sl_price?: number | null
          status?: Database["public"]["Enums"]["trade_status"] | null
          symbol?: string
          tp_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "trades_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      user_settings: {
        Row: {
          burst_daily_target_pct: number | null
          burst_size: number | null
          id: string
          max_concurrent_risk_pct: number | null
          max_daily_loss_pct: number | null
          show_advanced_explanations: boolean | null
          use_ai_reasoning: boolean | null
          use_news_api: boolean | null
          user_id: string
        }
        Insert: {
          burst_daily_target_pct?: number | null
          burst_size?: number | null
          id?: string
          max_concurrent_risk_pct?: number | null
          max_daily_loss_pct?: number | null
          show_advanced_explanations?: boolean | null
          use_ai_reasoning?: boolean | null
          use_news_api?: boolean | null
          user_id: string
        }
        Update: {
          burst_daily_target_pct?: number | null
          burst_size?: number | null
          id?: string
          max_concurrent_risk_pct?: number | null
          max_daily_loss_pct?: number | null
          show_advanced_explanations?: boolean | null
          use_ai_reasoning?: boolean | null
          use_news_api?: boolean | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      account_type: "paper" | "live"
      batch_close_reason:
        | "tp_hit"
        | "stop_hit"
        | "manual_take_burst_profit"
        | "global_close"
        | "error"
      batch_status: "pending" | "active" | "closed" | "stopped"
      connection_status: "connected" | "error" | "disconnected"
      log_level: "info" | "warn" | "error"
      log_source: "execution" | "broker" | "risk" | "ai" | "burst"
      trade_side: "long" | "short"
      trade_status: "open" | "closed" | "error"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_type: ["paper", "live"],
      batch_close_reason: [
        "tp_hit",
        "stop_hit",
        "manual_take_burst_profit",
        "global_close",
        "error",
      ],
      batch_status: ["pending", "active", "closed", "stopped"],
      connection_status: ["connected", "error", "disconnected"],
      log_level: ["info", "warn", "error"],
      log_source: ["execution", "broker", "risk", "ai", "burst"],
      trade_side: ["long", "short"],
      trade_status: ["open", "closed", "error"],
    },
  },
} as const
