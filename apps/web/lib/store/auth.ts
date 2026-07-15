import { create } from 'zustand';

interface AuthState {
  publicKey: string | null;
  jwt: string | null;
  isAuthenticated: boolean;
  isConnecting: boolean;
  setAuth: (publicKey: string, jwt: string) => void;
  setConnecting: (status: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  publicKey: null,
  jwt: null,
  isAuthenticated: false,
  isConnecting: false,
  
  setAuth: (publicKey, jwt) => set({ 
    publicKey, 
    jwt, 
    isAuthenticated: true,
    isConnecting: false 
  }),
  
  setConnecting: (status) => set({ isConnecting: status }),
  
  logout: () => {
    // Also remove cookies/localStorage if needed, though JWT is usually HTTP-only or handled by api routes
    // But since we are saving it client side for now to send via Authorization headers:
    localStorage.removeItem('titip_jwt');
    localStorage.removeItem('titip_pubkey');
    set({ publicKey: null, jwt: null, isAuthenticated: false });
  },
}));
