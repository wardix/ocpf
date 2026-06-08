import { create } from 'zustand';
import { useAuthStore } from './authStore';

export interface AppNotification {
  id: number;
  user_id: number;
  account_id: number;
  type: string;
  title: string;
  body: string;
  data: any;
  read_at: string | null;
  created_at: string;
}

interface NotificationState {
  notifications: AppNotification[];
  unreadCount: number;
  loading: boolean;
  fetchNotifications: () => Promise<void>;
  markAsRead: (id: number) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  addNotification: (notification: AppNotification) => void;
  requestPushPermission: () => Promise<boolean>;
}

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  loading: false,

  fetchNotifications: async () => {
    set({ loading: true });
    try {
      const token = useAuthStore.getState().token;
      const res = await fetch(`${apiUrl}/api/notifications?page=1&per_page=50`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const { data, meta } = await res.json();
        set({ notifications: data, unreadCount: meta.unread_count });
      }
    } catch (error) {
      console.error('Failed to fetch notifications', error);
    } finally {
      set({ loading: false });
    }
  },

  markAsRead: async (id: number) => {
    try {
      const token = useAuthStore.getState().token;
      const res = await fetch(`${apiUrl}/api/notifications/${id}/read`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        set((state) => ({
          notifications: state.notifications.map(n => 
            n.id === id ? { ...n, read_at: new Date().toISOString() } : n
          ),
          unreadCount: Math.max(0, state.unreadCount - 1)
        }));
      }
    } catch (error) {
      console.error('Failed to mark notification as read', error);
    }
  },

  markAllAsRead: async () => {
    try {
      const token = useAuthStore.getState().token;
      const res = await fetch(`${apiUrl}/api/notifications/read-all`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        set((state) => ({
          notifications: state.notifications.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() })),
          unreadCount: 0
        }));
      }
    } catch (error) {
      console.error('Failed to mark all as read', error);
    }
  },

  addNotification: (notification: AppNotification) => {
    set((state) => ({
      notifications: [notification, ...state.notifications],
      unreadCount: state.unreadCount + 1
    }));
    
    // Show browser push notification
    if (Notification.permission === 'granted') {
      new Notification(notification.title, {
        body: notification.body || '',
        icon: '/favicon.ico'
      });
    }
  },

  requestPushPermission: async () => {
    if (!('Notification' in window)) {
      alert('Browser Anda tidak mendukung push notification.');
      return false;
    }
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }
}));
