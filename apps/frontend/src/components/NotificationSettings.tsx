import React, { useState, useEffect } from 'react';
import { useNotificationStore } from '../store/notificationStore';
import { useToastStore } from '../store/toastStore';

export default function NotificationSettings() {
  const { requestPushPermission } = useNotificationStore();
  const { addToast } = useToastStore();
  const [permissionStatus, setPermissionStatus] = useState<string>('default');

  useEffect(() => {
    if ('Notification' in window) {
      setPermissionStatus(Notification.permission);
    } else {
      setPermissionStatus('unsupported');
    }
  }, []);

  const handleRequestPermission = async () => {
    const granted = await requestPushPermission();
    setPermissionStatus(granted ? 'granted' : 'denied');
    if (granted) {
      addToast('Notifikasi browser diaktifkan', 'success');
    } else {
      addToast('Akses notifikasi browser ditolak', 'warning');
    }
  };

  return (
    <div className="card bg-base-100 shadow-sm border border-base-300">
      <div className="card-body">
        <h2 className="card-title text-xl mb-1">🔔 Pengaturan Notifikasi</h2>
        <p className="text-sm text-base-content/60 mb-4">
          Kelola cara Anda menerima pemberitahuan tentang pesan masuk, tugas baru, dan sebutan (mention).
        </p>

        <div className="flex items-center justify-between p-4 bg-base-200/50 rounded-lg">
          <div>
            <p className="font-semibold text-sm">Push Notification Browser</p>
            <p className="text-xs text-base-content/70">Terima pemberitahuan langsung di layar komputer Anda meskipun tab browser tidak aktif.</p>
          </div>
          <div>
            {permissionStatus === 'granted' ? (
              <span className="badge badge-success font-semibold p-3">Diaktifkan</span>
            ) : permissionStatus === 'denied' ? (
              <span className="badge badge-error font-semibold p-3 text-white">Ditolak</span>
            ) : permissionStatus === 'unsupported' ? (
              <span className="badge badge-ghost font-semibold p-3">Tidak Didukung</span>
            ) : (
              <button 
                onClick={handleRequestPermission}
                className="btn btn-sm btn-primary"
              >
                Aktifkan
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
