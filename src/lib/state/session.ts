import { create } from 'zustand';

export type AccountType = 'paper' | 'live';
export type SessionStatus = 'idle' | 'arming' | 'running' | 'holding' | 'stopped' | 'error';

interface SessionState {
  accountType: AccountType;
  status: SessionStatus;
  selectedSymbol: string | null;
  
  setAccountType: (type: AccountType) => void;
  setStatus: (status: SessionStatus) => void;
  setSymbol: (sym: string | null) => void;
}

export const useSession = create<SessionState>((set) => ({
  accountType: 'paper',
  status: 'idle',
  selectedSymbol: null,

  setAccountType: (type) => set({ accountType: type, status: 'idle' }),
  setStatus: (status) => set({ status }),
  setSymbol: (sym) => set({ selectedSymbol: sym }),
}));
