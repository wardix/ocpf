import React, { useEffect, useState } from 'react';
import { useNotificationStore } from '../store/notificationStore';

const formatTimeAgo = (dateStr: string) => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  
  if (diffInSeconds < 60) return 'Baru saja';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} menit yang lalu`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} jam yang lalu`;
  return `${Math.floor(diffInSeconds / 86400)} hari yang lalu`;
};

export default function NotificationBell() {
  const { notifications, unreadCount, fetchNotifications, markAsRead, markAllAsRead } = useNotificationStore();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const toggleDropdown = () => setIsOpen(!isOpen);

  const handleNotificationClick = (notificationId: number, data: any) => {
    markAsRead(notificationId);
    setIsOpen(false);
    // Jika data ada conversation_id, dispatch custom event atau pakai router 
    // karena navigasi di sidebar biasanya via `setSelectedConv`
    if (data?.conversation_id) {
      window.dispatchEvent(new CustomEvent('navigateToConversation', { detail: data.conversation_id }));
    }
  };

  return (
    <div className="relative z-50">
      <button 
        onClick={toggleDropdown}
        className="btn btn-ghost btn-circle relative"
      >
        <span className="text-xl">🔔</span>
        {unreadCount > 0 && (
          <span className="badge badge-sm badge-error absolute top-0 right-0">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-base-100 shadow-xl rounded-box border border-base-200 overflow-hidden flex flex-col max-h-[80vh]">
          <div className="p-3 border-b border-base-200 flex justify-between items-center bg-base-200">
            <h3 className="font-bold text-sm">Notifikasi</h3>
            {unreadCount > 0 && (
              <button onClick={markAllAsRead} className="text-xs text-primary hover:underline">
                Tandai semua dibaca
              </button>
            )}
          </div>
          
          <div className="overflow-y-auto p-0 flex-1">
            {notifications.length === 0 ? (
              <div className="p-4 text-center text-sm text-base-content/60">
                Tidak ada notifikasi
              </div>
            ) : (
              <ul className="menu p-0">
                {notifications.map(notif => (
                  <li key={notif.id} className={notif.read_at ? '' : 'bg-base-200/50'}>
                    <a 
                      onClick={() => handleNotificationClick(notif.id, notif.data)}
                      className="flex flex-col items-start gap-1 p-3 border-b border-base-200 last:border-0 rounded-none"
                    >
                      <div className="flex justify-between w-full items-start gap-2">
                        <span className={`font-semibold text-sm ${notif.read_at ? 'text-base-content/80' : 'text-base-content'}`}>
                          {notif.title}
                        </span>
                        {!notif.read_at && <span className="w-2 h-2 rounded-full bg-primary mt-1 shrink-0"></span>}
                      </div>
                      <p className="text-xs text-base-content/70 line-clamp-2">
                        {notif.body}
                      </p>
                      <span className="text-[10px] text-base-content/50 mt-1">
                        {formatTimeAgo(notif.created_at)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
