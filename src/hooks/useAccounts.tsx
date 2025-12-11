import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

type Account = Tables<'accounts'>;
type AccountInsert = TablesInsert<'accounts'>;
type AccountUpdate = TablesUpdate<'accounts'>;

export function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .order('created_at', { ascending: true });
      
      if (error) throw error;
      return data as Account[];
    },
  });
}

export function useActiveAccount() {
  return useQuery({
    queryKey: ['accounts', 'active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('is_active', true)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error;
      return data as Account | null;
    },
  });
}

export function useSetActiveAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (accountId: string) => {
      // First, deactivate all accounts
      const { error: deactivateError } = await supabase
        .from('accounts')
        .update({ is_active: false })
        .neq('id', '');

      if (deactivateError) throw deactivateError;

      // Then activate the selected account
      const { data, error } = await supabase
        .from('accounts')
        .update({ is_active: true })
        .eq('id', accountId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}

export function useUpdateAccountEquity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ accountId, equity }: { accountId: string; equity: number }) => {
      const { data, error } = await supabase
        .from('accounts')
        .update({ equity })
        .eq('id', accountId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}
