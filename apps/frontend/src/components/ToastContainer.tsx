import React from 'react';
import { useToastStore } from '../store/toastStore';

export const ToastContainer = () => {
  const { toasts, removeToast } = useToastStore();
  
  if (toasts.length === 0) return null;

  return (
    <div className="toast toast-top toast-center z-[9999]">
      {toasts.map((t) => (
        <div 
          key={t.id} 
          className={`alert shadow-lg cursor-pointer ${
            t.type === 'success' ? 'alert-success text-white' : 
            t.type === 'error' ? 'alert-error text-white' : 
            t.type === 'warning' ? 'alert-warning' : 'alert-info'
          }`}
          onClick={() => removeToast(t.id)}
        >
          {t.type === 'success' && <span>✅</span>}
          {t.type === 'error' && <span>❌</span>}
          {t.type === 'warning' && <span>⚠️</span>}
          {t.type === 'info' && <span>ℹ️</span>}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
};
