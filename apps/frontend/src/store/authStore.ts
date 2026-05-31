import { create } from 'zustand';

interface AuthState {
  token: string | null;
  user: any | null;
  login: (token: string, user: any) => void;
  logout: () => void;
}

const getInitialUser = () => {
  const t = localStorage.getItem('omni_token');
  if (!t) return null;
  try {
    const base64Url = t.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
};

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('omni_token'),
  user: getInitialUser(),
  login: (token, user) => {
    localStorage.setItem('omni_token', token);
    set({ token, user });
  },
  logout: () => {
    localStorage.removeItem('omni_token');
    set({ token: null, user: null });
  }
}));
