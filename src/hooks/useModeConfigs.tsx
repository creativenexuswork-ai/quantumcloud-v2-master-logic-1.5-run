import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tables, TablesUpdate } from '@/integrations/supabase/types';

type ModeConfig = Tables<'mode_configs'>;
type ModeConfigUpdate = TablesUpdate<'mode_configs'>;

export const MODE_DEFINITIONS = {
  sniper: {
    name: 'Sniper Mode',
    description: 'Low frequency, high conviction trades on higher timeframes.',
    risk: 'Safe',
    icon: '🎯',
  },
  quantum: {
    name: 'Quantum Hybrid',
    description: 'Adaptive mode that switches between Sniper, Burst, and Trend based on market regime.',
    risk: 'Balanced',
    icon: '⚛️',
  },
  burst: {
    name: 'Burst Mode',
    description: 'High-intensity cluster trading with micro-positions for quick momentum captures.',
    risk: 'Aggressive',
    icon: '⚡',
  },
  trend: {
    name: 'Trend Mode',
    description: 'Follow established trends with entries on pullbacks or breakouts.',
    risk: 'Balanced',
    icon: '📈',
  },
  swing: {
    name: 'Swing Mode',
    description: 'Higher timeframe trading for larger moves with longer hold times.',
    risk: 'Balanced',
    icon: '🌊',
  },
  news: {
    name: 'News-Aware Mode',
    description: 'Trades filtered by news sentiment and economic events.',
    risk: 'Safe',
    icon: '📰',
  },
  stealth: {
    name: 'Stealth Mode',
    description: 'Human-like trading patterns with randomized timing and sizing.',
    risk: 'Safe',
    icon: '🥷',
  },
  memory: {
    name: 'Memory Mode',
    description: 'Self-adjusting mode that learns from recent trade performance.',
    risk: 'Balanced',
    icon: '🧠',
  },
} as const;

export type ModeKey = keyof typeof MODE_DEFINITIONS;

export function useModeConfigs() {
  return useQuery({
    queryKey: ['mode_configs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mode_configs')
        .select('*')
        .order('mode_key');

      if (error) throw error;
      return data as ModeConfig[];
    },
  });
}

export function useModeConfig(modeKey: ModeKey) {
  return useQuery({
    queryKey: ['mode_configs', modeKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mode_configs')
        .select('*')
        .eq('mode_key', modeKey)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data as ModeConfig | null;
    },
  });
}

export function useUpdateModeConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: ModeConfigUpdate }) => {
      const { data, error } = await supabase
        .from('mode_configs')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mode_configs'] });
    },
  });
}

export function useToggleMode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { data, error } = await supabase
        .from('mode_configs')
        .update({ enabled })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mode_configs'] });
    },
  });
}
