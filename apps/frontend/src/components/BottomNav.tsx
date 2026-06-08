import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useUiStore, MobileView } from '../store/uiStore';
import { useAuthStore } from '../store/authStore';

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthStore();
  const { activeView, setActiveView } = useUiStore();

  const handleNav = (view: MobileView, path: string) => {
    setActiveView(view);
    navigate(path);
  };

  return (
    <div className="btm-nav btm-nav-sm z-50 md:hidden bg-base-200 border-t border-base-300">
      <button 
        className={location.pathname.startsWith('/inbox') || location.pathname === '/' ? 'active text-primary' : 'text-base-content/60'}
        onClick={() => handleNav('sidebar', '/inbox')}
      >
        <span className="text-xl">💬</span>
        <span className="btm-nav-label text-[10px]">Inbox</span>
      </button>
      <button 
        className={location.pathname.startsWith('/contacts') ? 'active text-primary' : 'text-base-content/60'}
        onClick={() => handleNav('contacts', '/contacts')}
      >
        <span className="text-xl">👥</span>
        <span className="btm-nav-label text-[10px]">Kontak</span>
      </button>
      {user?.role === 'administrator' && (
        <button 
          className={location.pathname.startsWith('/settings') ? 'active text-primary' : 'text-base-content/60'}
          onClick={() => handleNav('settings', '/settings')}
        >
          <span className="text-xl">⚙️</span>
          <span className="btm-nav-label text-[10px]">Settings</span>
        </button>
      )}
    </div>
  );
}
