import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tables, TablesInsert } from '@/integrations/supabase/types';

type Trade = Tables<'trades'>;
type TradeInsert = TablesInsert<'trades'>;

export function useTrades(accountId?: string) {
  return useQuery({
    queryKey: ['trades', accountId],
    queryFn: async () => {
      let query = supabase
        .from('trades')
        .select('*')
        .order('opened_at', { ascending: false });

      if (accountId) {
        query = query.eq('account_id', accountId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Trade[];
    },
    enabled: !!accountId,
  });
}

export function useOpenTrades(accountId?: string) {
  return useQuery({
    queryKey: ['trades', 'open', accountId],
    queryFn: async () => {
      let query = supabase
        .from('trades')
        .select('*')
        .eq('status', 'open')
        .order('opened_at', { ascending: false });

      if (accountId) {
        query = query.eq('account_id', accountId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Trade[];
    },
    enabled: !!accountId,
  });
}

export function useTodayTrades(accountId?: string) {
  return useQuery({
    queryKey: ['trades', 'today', accountId],
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let query = supabase
        .from('trades')
        .select('*')
        .gte('opened_at', today.toISOString())
        .order('opened_at', { ascending: false });

      if (accountId) {
        query = query.eq('account_id', accountId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Trade[];
    },
    enabled: !!accountId,
  });
}

export function useCreateTrade() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (trade: TradeInsert) => {
      const { data, error } = await supabase
        .from('trades')
        .insert(trade)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trades'] });
    },
  });
}

export function useCloseTrade() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ tradeId, exitPrice, pnl }: { tradeId: string; exitPrice: number; pnl: number }) => {
      const { data, error } = await supabase
        .from('trades')
        .update({
          status: 'closed',
          exit_price: exitPrice,
          pnl,
          closed_at: new Date().toISOString(),
        })
        .eq('id', tradeId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trades'] });
    },
  });
}

export function useTradeStats(accountId?: string) {
  const { data: trades } = useTrades(accountId);
  const { data: todayTrades } = useTodayTrades(accountId);

  const closedTrades = trades?.filter(t => t.status === 'closed') || [];
  const winningTrades = closedTrades.filter(t => (t.pnl || 0) > 0);
  
  const winRate = closedTrades.length > 0 
    ? (winningTrades.length / closedTrades.length) * 100 
    : 0;

  const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const todayPnl = todayTrades?.reduce((sum, t) => sum + (t.pnl || 0), 0) || 0;

  return {
    totalTrades: closedTrades.length,
    todayTrades: todayTrades?.length || 0,
    winRate,
    totalPnl,
    todayPnl,
  };
}
