import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tables, TablesUpdate } from '@/integrations/supabase/types';

type UserSettings = Tables<'user_settings'>;
type UserSettingsUpdate = TablesUpdate<'user_settings'>;

export function useUserSettings() {
  return useQuery({
    queryKey: ['user_settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data as UserSettings | null;
    },
  });
}

export function useUpdateUserSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: UserSettingsUpdate) => {
      const { data: existing } = await supabase
        .from('user_settings')
        .select('id')
        .single();

      if (!existing) {
        throw new Error('User settings not found');
      }

      const { data, error } = await supabase
        .from('user_settings')
        .update(updates)
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user_settings'] });
    },
  });
}
