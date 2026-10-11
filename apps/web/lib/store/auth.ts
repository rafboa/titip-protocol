import { create } from 'zustand';

// The session JWT lives only in an HttpOnly cookie (set by /api/auth/verify), so
// it is never stored here or in localStorage. This store holds UI state only.
interface AuthState {
  publicKey: string | null;
  isAuthenticated: boolean;
  isConnecting: boolean;
  /** True until the first /api/auth/session check finishes — avoids redirecting too early. */
  isRestoring: boolean;
  setAuth: (publicKey: string) => void;
  setConnecting: (status: boolean) => void;
  setRestored: () => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  publicKey: null,
  isAuthenticated: false,
  isConnecting: false,
  isRestoring: true,

  setAuth: (publicKey) =>
    set({ publicKey, isAuthenticated: true, isConnecting: false, isRestoring: false }),

  setConnecting: (status) => set({ isConnecting: status }),

  setRestored: () => set({ isRestoring: false }),

  logout: async () => {
    try {
      // Server clears the HttpOnly cookie; page scripts cannot.
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Network failure: still clear local UI state; the cookie expires on its own.
    }
    set({ publicKey: null, isAuthenticated: false });
  },
}));
