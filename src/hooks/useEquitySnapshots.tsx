import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tables } from '@/integrations/supabase/types';

type EquitySnapshot = Tables<'equity_snapshots'>;

export function useEquitySnapshots(accountId?: string, days = 30) {
  return useQuery({
    queryKey: ['equity_snapshots', accountId, days],
    queryFn: async () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const { data, error } = await supabase
        .from('equity_snapshots')
        .select('*')
        .eq('account_id', accountId!)
        .gte('timestamp', startDate.toISOString())
        .order('timestamp', { ascending: true });

      if (error) throw error;
      return data as EquitySnapshot[];
    },
    enabled: !!accountId,
  });
}

export function useLatestEquitySnapshot(accountId?: string) {
  return useQuery({
    queryKey: ['equity_snapshots', 'latest', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('equity_snapshots')
        .select('*')
        .eq('account_id', accountId!)
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data as EquitySnapshot | null;
    },
    enabled: !!accountId,
  });
}
