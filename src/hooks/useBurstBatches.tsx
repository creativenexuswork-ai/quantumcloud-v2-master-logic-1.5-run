import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tables, TablesInsert } from '@/integrations/supabase/types';

type BurstBatch = Tables<'burst_batches'>;
type BurstBatchInsert = TablesInsert<'burst_batches'>;

export function useBurstBatches(accountId?: string) {
  return useQuery({
    queryKey: ['burst_batches', accountId],
    queryFn: async () => {
      let query = supabase
        .from('burst_batches')
        .select('*')
        .order('opened_at', { ascending: false });

      if (accountId) {
        query = query.eq('account_id', accountId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as BurstBatch[];
    },
    enabled: !!accountId,
  });
}

export function useActiveBurstBatch(accountId?: string) {
  return useQuery({
    queryKey: ['burst_batches', 'active', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('burst_batches')
        .select('*')
        .eq('account_id', accountId!)
        .eq('status', 'active')
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data as BurstBatch | null;
    },
    enabled: !!accountId,
  });
}

export function useTodayBurstStats(accountId?: string) {
  return useQuery({
    queryKey: ['burst_batches', 'today', accountId],
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from('burst_batches')
        .select('*')
        .eq('account_id', accountId!)
        .gte('opened_at', today.toISOString());

      if (error) throw error;
      
      const batches = data as BurstBatch[];
      const totalPnl = batches.reduce((sum, b) => sum + (b.result_pct || 0), 0);
      const completedBursts = batches.filter(b => b.status === 'closed').length;
      const activeBurst = batches.find(b => b.status === 'active');

      return {
        totalPnl,
        burstsToday: batches.length,
        completedBursts,
        hasActiveBurst: !!activeBurst,
        activeBurst,
      };
    },
    enabled: !!accountId,
  });
}

export function useCreateBurstBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (batch: BurstBatchInsert) => {
      const { data, error } = await supabase
        .from('burst_batches')
        .insert(batch)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['burst_batches'] });
    },
  });
}

export function useCloseBurstBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      batchId, 
      resultPct, 
      reasonClosed 
    }: { 
      batchId: string; 
      resultPct: number; 
      reasonClosed: 'tp_hit' | 'stop_hit' | 'manual_take_burst_profit' | 'global_close' | 'error';
    }) => {
      const { data, error } = await supabase
        .from('burst_batches')
        .update({
          status: 'closed',
          result_pct: resultPct,
          reason_closed: reasonClosed,
          closed_at: new Date().toISOString(),
        })
        .eq('id', batchId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['burst_batches'] });
    },
  });
}
