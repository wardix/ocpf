import React, { useState, useEffect } from 'react';
import UserManagement from './UserManagement';
import LabelManagement from './LabelManagement';
import InboxManagement from './InboxManagement';
import WebhookManagement from './WebhookManagement';
import AutomationManagement from './AutomationManagement';
import MessageTemplateManagement from './MessageTemplateManagement';
import { ApiKeyManagement } from './ApiKeyManagement';
import { useAuthStore } from '../store/authStore';
import { ConfirmModal } from './ConfirmModal';
import { useToastStore } from '../store/toastStore';

interface CannedResponse {
  id: number;
  short_code: string;
  content: string;
}

const Settings = () => {
  const { token, user } = useAuthStore();
  const { addToast } = useToastStore();
  const [cannedResponses, setCannedResponses] = useState<CannedResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState<number | null>(null);
  const [formData, setFormData] = useState({ short_code: '', content: '' });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'users' | 'labels' | 'canned' | 'templates' | 'inboxes' | 'webhooks' | 'automation' | 'apikeys'>('inboxes');

  // Inboxes State
  const [inboxes, setInboxes] = useState<any[]>([]);
  const [activeInboxId, setActiveInboxId] = useState<number | null>(null);

  // Inbox Settings State
  const [inboxSettings, setInboxSettings] = useState({
    auto_assignment_enabled: false,
    auto_assignment_algorithm: 'round_robin',
    auto_assignment_max_tickets: 10,
    csat_enabled: false,
    csat_delay_minutes: 5,
    csat_message: 'Terima kasih telah menghubungi kami! Bagaimana penilaian Anda terhadap layanan kami? Reply 1-5 (1=Sangat Buruk, 5=Sangat Baik)'
  });
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // Business Hours State
  const [bhSettings, setBhSettings] = useState({
    business_hours_enabled: false,
    timezone: 'Asia/Jakarta',
    out_of_office_message: 'Terima kasih telah menghubungi kami. Saat ini di luar jam operasional, kami akan merespons pada jam kerja berikutnya.',
    schedules: Array.from({ length: 7 }, (_, i) => ({
      day_of_week: i,
      open_time: '08:00',
      close_time: '17:00',
      is_closed: false
    }))
  });
  const [loadingBh, setLoadingBh] = useState(false);
  const [savingBh, setSavingBh] = useState(false);

  // AI Settings State
  const [aiSettings, setAiSettings] = useState({
    provider: 'openai',
    api_key: '',
    model: 'gpt-4o',
    max_tokens: 500,
    temperature: 0.7,
    is_active: false,
    features_enabled: ['smart_reply', 'summarize', 'auto_categorize'] as string[]
  });
  const [aiStats, setAiStats] = useState({
    total_calls: 0,
    total_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    hourly_calls: 0,
    hourly_limit: 50
  });
  const [loadingAi, setLoadingAi] = useState(false);
  const [savingAi, setSavingAi] = useState(false);

  const fetchCanned = async () => {
    if (!token) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/canned-responses?page=${page}&per_page=25`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const result = await response.json();
        setCannedResponses(result.data);
        setTotalPages(Math.ceil(result.meta.total / result.meta.per_page));
      }
    } catch (err) {
      console.error('Gagal mengambil canned responses:', err);
    }
  };

  const fetchInboxes = async () => {
    if (!token) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/inboxes`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          setInboxes(result.data);
          // Default to first inbox if none selected and inboxes exist
          if (result.data.length > 0 && activeInboxId === null) {
            setActiveInboxId(result.data[0].id);
          }
        }
      }
    } catch (err) {
      console.error('Gagal mengambil daftar inbox:', err);
    }
  };

  const fetchInboxSettings = async () => {
    if (!token || activeInboxId === null) return;
    setLoadingSettings(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/inboxes/${activeInboxId}/settings`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          setInboxSettings(result.data);
        }
      }
    } catch (err) {
      console.error('Gagal mengambil setting inbox:', err);
    } finally {
      setLoadingSettings(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || activeInboxId === null) return;
    setSavingSettings(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/inboxes/${activeInboxId}/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          auto_assignment_enabled: inboxSettings.auto_assignment_enabled,
          auto_assignment_algorithm: inboxSettings.auto_assignment_algorithm,
          auto_assignment_max_tickets: Number(inboxSettings.auto_assignment_max_tickets),
          csat_enabled: inboxSettings.csat_enabled,
          csat_delay_minutes: Number(inboxSettings.csat_delay_minutes),
          csat_message: inboxSettings.csat_message
        })
      });
      if (response.ok) {
        addToast('Pengaturan inbox berhasil diperbarui', 'success');
      } else {
        const errorResult = await response.json();
        addToast(`Gagal menyimpan: ${errorResult.error || 'Terjadi kesalahan'}`, 'error');
      }
    } catch (err) {
      console.error(err);
      addToast('Gagal menghubungi server', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const fetchBusinessHours = async () => {
    if (!token || activeInboxId === null) return;
    setLoadingBh(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/inboxes/${activeInboxId}/business-hours`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          const normSchedules = result.data.schedules.map((s: any) => ({
            day_of_week: s.day_of_week,
            open_time: (s.open_time || '08:00:00').substring(0, 5),
            close_time: (s.close_time || '17:00:00').substring(0, 5),
            is_closed: !!s.is_closed
          }));
          setBhSettings({
            business_hours_enabled: !!result.data.business_hours_enabled,
            timezone: result.data.timezone || 'Asia/Jakarta',
            out_of_office_message: result.data.out_of_office_message || '',
            schedules: normSchedules
          });
        }
      }
    } catch (err) {
      console.error('Gagal mengambil jam operasional:', err);
    } finally {
      setLoadingBh(false);
    }
  };

  const handleSaveBusinessHours = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || activeInboxId === null) return;
    setSavingBh(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/inboxes/${activeInboxId}/business-hours`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          business_hours_enabled: bhSettings.business_hours_enabled,
          timezone: bhSettings.timezone,
          out_of_office_message: bhSettings.out_of_office_message,
          schedules: bhSettings.schedules.map(s => ({
            day_of_week: s.day_of_week,
            open_time: s.open_time,
            close_time: s.close_time,
            is_closed: s.is_closed
          }))
        })
      });
      if (response.ok) {
        addToast('Jam operasional berhasil diperbarui', 'success');
        fetchBusinessHours();
      } else {
        const errorResult = await response.json();
        addToast(`Gagal menyimpan: ${errorResult.error || 'Terjadi kesalahan'}`, 'error');
      }
    } catch (err) {
      console.error(err);
      addToast('Gagal menghubungi server', 'error');
    } finally {
      setSavingBh(false);
    }
  };

  useEffect(() => {
    fetchCanned();
  }, [token, page]);

  useEffect(() => {
    fetchInboxes();
  }, [token]);

  useEffect(() => {
    if (activeInboxId !== null) {
      fetchInboxSettings();
      fetchBusinessHours();
    }
  }, [token, activeInboxId]);

  const fetchAiSettings = async () => {
    if (!token || user?.role !== 'administrator') return;
    setLoadingAi(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/ai/settings`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          const { config, stats } = result.data;
          if (config) {
            setAiSettings({
              provider: config.provider || 'openai',
              api_key: '••••••••••••••••',
              model: config.model || '',
              max_tokens: config.max_tokens || 500,
              temperature: Number(config.temperature) || 0.7,
              is_active: !!config.is_active,
              features_enabled: config.features_enabled || []
            });
          }
          if (stats) {
            setAiStats(stats);
          }
        }
      }
    } catch (err) {
      console.error('Gagal mengambil pengaturan AI:', err);
    } finally {
      setLoadingAi(false);
    }
  };

  const handleSaveAiSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || user?.role !== 'administrator') return;
    setSavingAi(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/ai/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          provider: aiSettings.provider,
          api_key: aiSettings.api_key,
          model: aiSettings.model,
          max_tokens: Number(aiSettings.max_tokens),
          temperature: Number(aiSettings.temperature),
          is_active: aiSettings.is_active,
          features_enabled: aiSettings.features_enabled
        })
      });

      if (response.ok) {
        addToast('Konfigurasi AI berhasil diperbarui', 'success');
        fetchAiSettings();
      } else {
        const errorResult = await response.json();
        addToast(`Gagal menyimpan konfigurasi AI: ${errorResult.error || 'Terjadi kesalahan'}`, 'error');
      }
    } catch (err) {
      console.error(err);
      addToast('Gagal menghubungi server', 'error');
    } finally {
      setSavingAi(false);
    }
  };

  const handleFeatureToggle = (feature: string) => {
    setAiSettings(prev => {
      const isEnabled = prev.features_enabled.includes(feature);
      const newFeatures = isEnabled
        ? prev.features_enabled.filter(f => f !== feature)
        : [...prev.features_enabled, feature];
      return { ...prev, features_enabled: newFeatures };
    });
  };

  useEffect(() => {
    fetchAiSettings();
  }, [token, user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setLoading(true);
    
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const method = isEditing ? 'PUT' : 'POST';
      const endpoint = isEditing ? `/api/canned-responses/${isEditing}` : '/api/canned-responses';

      const response = await fetch(`${apiUrl}${endpoint}`, {
        method,
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        setFormData({ short_code: '', content: '' });
        setIsEditing(null);
        fetchCanned();
      } else {
        alert('Gagal menyimpan template');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const executeDelete = async (id: number) => {
    if (!token) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/canned-responses/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        fetchCanned();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const handleEdit = (item: CannedResponse) => {
    setIsEditing(item.id);
    setFormData({ short_code: item.short_code, content: item.content });
  };

  const handleCancelEdit = () => {
    setIsEditing(null);
    setFormData({ short_code: '', content: '' });
  };

  return (
    <div className="flex-1 flex flex-col bg-base-200 h-full overflow-y-auto p-8">
      <div className="max-w-4xl w-full mx-auto space-y-6">
        
        <div>
          <h1 className="text-3xl font-bold">⚙️ Pengaturan</h1>
          <p className="text-base-content/60 mt-1">Kelola preferensi dan alat produktivitas agen di sini.</p>
        </div>

        <div className="tabs tabs-boxed bg-base-100 p-1">
          <a className={`tab ${activeTab === 'users' ? 'tab-active font-bold text-primary border-b-2 border-primary' : ''}`} onClick={() => setActiveTab('users')}>Pengguna</a>
          <a className={`tab ${activeTab === 'labels' ? 'tab-active font-bold text-primary border-b-2 border-primary' : ''}`} onClick={() => setActiveTab('labels')}>Label</a>
          <a className={`tab ${activeTab === 'canned' ? 'tab-active font-bold text-primary border-b-2 border-primary' : ''}`} onClick={() => setActiveTab('canned')}>Canned Responses</a>
          <a className={`tab ${activeTab === 'templates' ? 'tab-active font-bold text-primary border-b-2 border-primary' : ''}`} onClick={() => setActiveTab('templates')}>Template Pesan</a>
          <a className={`tab ${activeTab === 'inboxes' ? 'tab-active font-bold text-primary border-b-2 border-primary' : ''}`} onClick={() => setActiveTab('inboxes')}>Inbox & Channel</a>
          <a className={`tab ${activeTab === 'webhooks' ? 'tab-active font-bold text-primary border-b-2 border-primary' : ''}`} onClick={() => setActiveTab('webhooks')}>Webhooks</a>
          <a className={`tab ${activeTab === 'automation' ? 'tab-active font-bold text-primary border-b-2 border-primary' : ''}`} onClick={() => setActiveTab('automation')}>Automasi (Rules)</a>
          {user?.role === 'administrator' && (
            <a className={`tab ${activeTab === 'apikeys' ? 'tab-active font-bold text-primary border-b-2 border-primary' : ''}`} onClick={() => setActiveTab('apikeys')}>API Keys</a>
          )}
        </div>

        {activeTab === 'users' && <UserManagement />}
        {activeTab === 'labels' && <LabelManagement />}
        {activeTab === 'inboxes' && (
          <>
            {user?.role === 'administrator' && (
              <InboxManagement 
                inboxes={inboxes} 
                activeInboxId={activeInboxId} 
                setActiveInboxId={setActiveInboxId} 
                onRefreshInboxes={fetchInboxes} 
              />
            )}

            <div className="card bg-base-100 shadow-sm border border-base-300">
              <div className="card-body">
                <h2 className="card-title text-xl mb-1">
                  📬 Pengaturan Auto-Assignment & CSAT
                  {activeInboxId && (
                    <span className="badge badge-primary badge-sm ml-2">
                      {inboxes.find(i => i.id === activeInboxId)?.name || 'Loading...'}
                    </span>
                  )}
                </h2>
                <p className="text-sm text-base-content/60 mb-4">
                  Konfigurasi pembagian antrean pesan masuk otomatis ke agen secara adil dan merata.
                </p>

                {loadingSettings ? (
                  <div className="flex justify-center py-4">
                    <span className="loading loading-spinner loading-md text-primary"></span>
                  </div>
                ) : (
                  <form onSubmit={handleSaveSettings} className="space-y-4">
                    <div className="form-control">
                      <label className="label cursor-pointer justify-start gap-4 p-0">
                        <input 
                          type="checkbox" 
                          className="toggle toggle-primary toggle-sm"
                          checked={inboxSettings.auto_assignment_enabled}
                          onChange={e => setInboxSettings({ ...inboxSettings, auto_assignment_enabled: e.target.checked })}
                          disabled={user?.role !== 'administrator'}
                        />
                        <div>
                          <span className="label-text font-semibold">Aktifkan Alokasi Otomatis (Auto-Assignment)</span>
                          <p className="text-xs text-base-content/50">Tiket masuk baru akan langsung ditugaskan ke agen yang online.</p>
                        </div>
                      </label>
                    </div>

                    {inboxSettings.auto_assignment_enabled && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-base-200/50 p-4 rounded-xl border border-base-300 mt-2">
                        <div className="form-control w-full">
                          <label className="label">
                            <span className="label-text font-semibold text-xs">Algoritma Distribusi</span>
                          </label>
                          <select 
                            className="select select-sm select-bordered w-full"
                            value={inboxSettings.auto_assignment_algorithm}
                            onChange={e => setInboxSettings({ ...inboxSettings, auto_assignment_algorithm: e.target.value })}
                            disabled={user?.role !== 'administrator'}
                          >
                            <option value="round_robin">Round Robin (Bergilir Bergantian)</option>
                            <option value="least_busy">Least Busy (Beban Kerja Terendah)</option>
                          </select>
                          <label className="label">
                            <span className="label-text-alt text-[10px] text-base-content/60">
                              {inboxSettings.auto_assignment_algorithm === 'round_robin' 
                                ? 'Menugaskan tiket secara bergantian ke agen online berikutnya.' 
                                : 'Menugaskan tiket ke agen online yang memiliki tiket aktif paling sedikit.'}
                            </span>
                          </label>
                        </div>

                        <div className="form-control w-full">
                          <label className="label">
                            <span className="label-text font-semibold text-xs">Batas Maksimum Tiket Aktif</span>
                          </label>
                          <input 
                            type="number" 
                            min={1} 
                            max={100}
                            className="input input-sm input-bordered w-full"
                            value={inboxSettings.auto_assignment_max_tickets}
                            onChange={e => setInboxSettings({ ...inboxSettings, auto_assignment_max_tickets: parseInt(e.target.value, 10) || 10 })}
                            disabled={user?.role !== 'administrator'}
                          />
                          <label className="label">
                            <span className="label-text-alt text-[10px] text-base-content/60">
                              Mencegah agen kewalahan jika jumlah tiket aktif (open + pending) melampaui batas ini.
                            </span>
                          </label>
                        </div>
                      </div>
                    )}

                    <div className="divider"></div>

                    <div className="form-control">
                      <label className="label cursor-pointer justify-start gap-4 p-0">
                        <input 
                          type="checkbox" 
                          className="toggle toggle-secondary toggle-sm"
                          checked={inboxSettings.csat_enabled || false}
                          onChange={e => setInboxSettings({ ...inboxSettings, csat_enabled: e.target.checked })}
                          disabled={user?.role !== 'administrator'}
                        />
                        <div>
                          <span className="label-text font-semibold">Aktifkan Survei CSAT Otomatis</span>
                          <p className="text-xs text-base-content/50">Kirim survei kepuasan (rating 1-5) ke pelanggan setelah tiket di-resolve.</p>
                        </div>
                      </label>
                    </div>

                    {(inboxSettings.csat_enabled || false) && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-base-200/50 p-4 rounded-xl border border-base-300 mt-2">
                        <div className="form-control w-full md:col-span-1">
                          <label className="label">
                            <span className="label-text font-semibold text-xs">Jeda Kirim (Menit)</span>
                          </label>
                          <input 
                            type="number" 
                            min={1} 
                            max={1440}
                            className="input input-sm input-bordered w-full"
                            value={inboxSettings.csat_delay_minutes || 5}
                            onChange={e => setInboxSettings({ ...inboxSettings, csat_delay_minutes: parseInt(e.target.value, 10) || 5 })}
                            disabled={user?.role !== 'administrator'}
                          />
                          <label className="label">
                            <span className="label-text-alt text-[10px] text-base-content/60">
                              Jeda waktu tunggu setelah tiket ditutup sebelum survei dikirim.
                            </span>
                          </label>
                        </div>

                        <div className="form-control w-full md:col-span-2">
                          <label className="label">
                            <span className="label-text font-semibold text-xs">Pesan Survei CSAT</span>
                          </label>
                          <textarea 
                            className="textarea textarea-sm textarea-bordered w-full h-20 resize-none"
                            value={inboxSettings.csat_message || ''}
                            onChange={e => setInboxSettings({ ...inboxSettings, csat_message: e.target.value })}
                            placeholder="Masukan pesan instruksi survei..."
                            disabled={user?.role !== 'administrator'}
                            required
                          ></textarea>
                          <label className="label">
                            <span className="label-text-alt text-[10px] text-base-content/60">
                              Gunakan bahasa yang sopan. Pelanggan cukup membalas dengan angka 1 sampai 5.
                            </span>
                          </label>
                        </div>
                      </div>
                    )}

                    {user?.role === 'administrator' && (
                      <div className="flex justify-end mt-4">
                        <button 
                          type="submit" 
                          className={`btn btn-sm btn-primary ${savingSettings ? 'loading' : ''}`}
                          disabled={savingSettings}
                        >
                          Simpan Pengaturan Inbox
                        </button>
                      </div>
                    )}
                  </form>
                )}
              </div>
            </div>

            <div className="card bg-base-100 shadow-sm border border-base-300">
              <div className="card-body">
                <h2 className="card-title text-xl mb-1">
                  ⏰ Jam Operasional & Auto-Responder
                  {activeInboxId && (
                    <span className="badge badge-primary badge-sm ml-2">
                      {inboxes.find(i => i.id === activeInboxId)?.name || 'Loading...'}
                    </span>
                  )}
                </h2>
                <p className="text-sm text-base-content/60 mb-4">
                  Konfigurasi zona waktu, jam kerja mingguan, dan pesan otomatis saat kantor tutup.
                </p>

                {loadingBh ? (
                  <div className="flex justify-center py-4">
                    <span className="loading loading-spinner loading-md text-primary"></span>
                  </div>
                ) : (
                  <form onSubmit={handleSaveBusinessHours} className="space-y-4">
                    <div className="form-control">
                      <label className="label cursor-pointer justify-start gap-4 p-0">
                        <input 
                          type="checkbox" 
                          className="toggle toggle-primary toggle-sm"
                          checked={bhSettings.business_hours_enabled}
                          onChange={e => setBhSettings({ ...bhSettings, business_hours_enabled: e.target.checked })}
                          disabled={user?.role !== 'administrator'}
                        />
                        <div>
                          <span className="label-text font-semibold">Aktifkan Jam Operasional</span>
                          <p className="text-xs text-base-content/50">Kirim pesan otomatis saat di luar jam operasional dan set tiket ke status pending.</p>
                        </div>
                      </label>
                    </div>

                    {bhSettings.business_hours_enabled && (
                      <div className="space-y-4 bg-base-200/50 p-4 rounded-xl border border-base-300 mt-2">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="form-control w-full">
                            <label className="label">
                              <span className="label-text font-semibold text-xs">Zona Waktu</span>
                            </label>
                            <select 
                              className="select select-sm select-bordered w-full"
                              value={bhSettings.timezone}
                              onChange={e => setBhSettings({ ...bhSettings, timezone: e.target.value })}
                              disabled={user?.role !== 'administrator'}
                            >
                              <option value="Asia/Jakarta">WIB - Asia/Jakarta (UTC+7)</option>
                              <option value="Asia/Makassar">WITA - Asia/Makassar (UTC+8)</option>
                              <option value="Asia/Jayapura">WIT - Asia/Jayapura (UTC+9)</option>
                              <option value="Asia/Singapore">SGT - Asia/Singapore (UTC+8)</option>
                              <option value="UTC">UTC (Greenwich Mean Time)</option>
                            </select>
                          </div>

                          <div className="form-control w-full">
                            <label className="label">
                              <span className="label-text font-semibold text-xs">Pesan Auto-Responder (Di Luar Jam Kerja)</span>
                            </label>
                            <textarea 
                              className="textarea textarea-sm textarea-bordered w-full h-20 resize-none"
                              value={bhSettings.out_of_office_message}
                              onChange={e => setBhSettings({ ...bhSettings, out_of_office_message: e.target.value })}
                              placeholder="Pesan di luar jam operasional..."
                              disabled={user?.role !== 'administrator'}
                              required
                            ></textarea>
                          </div>
                        </div>

                        <div className="divider text-xs opacity-50">Jadwal Mingguan (Senin - Minggu)</div>

                        <div className="overflow-x-auto">
                          <table className="table table-xs w-full">
                            <thead>
                              <tr>
                                <th>Hari</th>
                                <th>Status Operasional</th>
                                <th>Jam Buka</th>
                                <th>Jam Tutup</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[1, 2, 3, 4, 5, 6, 0].map(dayIdx => {
                                const dayNameIndo = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][dayIdx];
                                const schedIndex = bhSettings.schedules.findIndex(s => s.day_of_week === dayIdx);
                                if (schedIndex === -1) return null;
                                const sched = bhSettings.schedules[schedIndex];

                                return (
                                  <tr key={dayIdx} className={sched.is_closed ? 'opacity-50' : ''}>
                                    <td className="font-semibold">{dayNameIndo}</td>
                                    <td>
                                      <label className="flex items-center gap-2 cursor-pointer">
                                        <input 
                                          type="checkbox"
                                          className="checkbox checkbox-sm checkbox-secondary"
                                          checked={!sched.is_closed}
                                          onChange={e => {
                                            const newScheds = [...bhSettings.schedules];
                                            newScheds[schedIndex].is_closed = !e.target.checked;
                                            setBhSettings({ ...bhSettings, schedules: newScheds });
                                          }}
                                          disabled={user?.role !== 'administrator'}
                                        />
                                        <span className="text-xs">{sched.is_closed ? 'Tutup' : 'Buka'}</span>
                                      </label>
                                    </td>
                                    <td>
                                      <input 
                                        type="time" 
                                        className="input input-xs input-bordered w-28"
                                        value={sched.open_time}
                                        onChange={e => {
                                          const newScheds = [...bhSettings.schedules];
                                          newScheds[schedIndex].open_time = e.target.value;
                                          setBhSettings({ ...bhSettings, schedules: newScheds });
                                        }}
                                        disabled={sched.is_closed || user?.role !== 'administrator'}
                                      />
                                    </td>
                                    <td>
                                      <input 
                                        type="time" 
                                        className="input input-xs input-bordered w-28"
                                        value={sched.close_time}
                                        onChange={e => {
                                          const newScheds = [...bhSettings.schedules];
                                          newScheds[schedIndex].close_time = e.target.value;
                                          setBhSettings({ ...bhSettings, schedules: newScheds });
                                        }}
                                        disabled={sched.is_closed || user?.role !== 'administrator'}
                                      />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {user?.role === 'administrator' && (
                      <div className="flex justify-end mt-4">
                        <button 
                          type="submit" 
                          className={`btn btn-sm btn-primary ${savingBh ? 'loading' : ''}`}
                          disabled={savingBh}
                        >
                          Simpan Jam Operasional
                        </button>
                      </div>
                    )}
                  </form>
                )}
              </div>
            </div>
          </>
        )}

        {activeTab === 'canned' && (
          <div className="card bg-base-100 shadow-sm border border-base-300">
            <div className="card-body">
              <h2 className="card-title text-xl mb-4">Canned Responses (Balasan Cepat)</h2>
              
              <form onSubmit={handleSave} className="flex flex-col gap-4 bg-base-200/50 p-4 rounded-xl border border-base-300">
                <h3 className="font-semibold text-sm text-base-content/70">
                  {isEditing ? '✏️ Edit Template' : '➕ Tambah Template Baru'}
                </h3>
                <div className="flex gap-4">
                  <div className="form-control w-1/3">
                    <label className="label"><span className="label-text text-xs">Short Code (Tanpa garis miring /)</span></label>
                    <input 
                      type="text" 
                      placeholder="misal: salam" 
                      className="input input-sm input-bordered w-full" 
                      value={formData.short_code}
                      onChange={e => setFormData({ ...formData, short_code: e.target.value.trim().toLowerCase() })}
                      required
                    />
                  </div>
                  <div className="form-control flex-1">
                    <label className="label"><span className="label-text text-xs">Isi Pesan</span></label>
                    <textarea 
                      className="textarea textarea-sm textarea-bordered w-full resize-none h-10" 
                      placeholder="Halo! Ada yang bisa kami bantu?"
                      value={formData.content}
                      onChange={e => setFormData({ ...formData, content: e.target.value })}
                      required
                    ></textarea>
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-2">
                  {isEditing && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={handleCancelEdit}>Batal</button>
                  )}
                  <button type="submit" className={`btn btn-sm btn-primary ${loading ? 'loading' : ''}`} disabled={loading}>
                    Simpan Template
                  </button>
                </div>
              </form>

              <div className="overflow-x-auto mt-6">
                <table className="table table-sm table-zebra w-full border border-base-200">
                  <thead className="bg-base-200">
                    <tr>
                      <th>Short Code</th>
                      <th>Isi Pesan</th>
                      <th className="w-32 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cannedResponses.length === 0 && (
                      <tr>
                        <td colSpan={3} className="text-center italic opacity-50 py-4">Belum ada template balasan cepat.</td>
                      </tr>
                    )}
                    {cannedResponses.map(item => (
                      <tr key={item.id}>
                        <td className="font-bold text-primary">/{item.short_code}</td>
                        <td className="whitespace-normal break-words max-w-sm text-sm">{item.content}</td>
                        <td className="text-right">
                          <div className="flex gap-1 justify-end">
                            <button onClick={() => handleEdit(item)} className="btn btn-xs btn-outline">Edit</button>
                            <button onClick={() => setDeleteConfirmId(item.id)} className="btn btn-xs btn-outline btn-error">Hapus</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between items-center mt-4">
                <span className="text-sm opacity-70">Halaman {page} dari {totalPages || 1}</span>
                <div className="btn-group">
                  <button 
                    className="btn btn-sm btn-outline" 
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    « Prev
                  </button>
                  <button 
                    className="btn btn-sm btn-outline" 
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                  >
                    Next »
                  </button>
                </div>
              </div>

            </div>
          </div>
        )}

        {activeTab === 'webhooks' && <WebhookManagement />}
        {activeTab === 'automation' && <AutomationManagement />}
        {activeTab === 'templates' && <MessageTemplateManagement />}

        {user?.role === 'administrator' && (
          <div className="card bg-base-100 shadow-sm border border-base-300">
            <div className="card-body">
              <div className="flex justify-between items-center mb-1">
                <h2 className="card-title text-xl flex items-center gap-2">
                  ✨ Integrasi Asisten AI
                </h2>
                <span className={`badge ${aiSettings.is_active ? 'badge-success' : 'badge-ghost'} badge-sm`}>
                  {aiSettings.is_active ? 'Aktif' : 'Nonaktif'}
                </span>
              </div>
              <p className="text-sm text-base-content/60 mb-6">
                Hubungkan dengan Google Gemini atau OpenAI untuk mendukung Smart Reply Suggestions, Ringkasan Obrolan, dan Kategorisasi Tiket otomatis.
              </p>

              {loadingAi ? (
                <div className="flex justify-center py-6">
                  <span className="loading loading-spinner loading-md text-primary"></span>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Stats Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-base-200/50 p-4 rounded-xl border border-base-300">
                    <div className="stat p-2">
                      <div className="stat-title text-[10px] uppercase font-bold tracking-wider">Total Panggilan (30 Hari)</div>
                      <div className="stat-value text-xl text-primary mt-1">{aiStats.total_calls}</div>
                    </div>
                    <div className="stat p-2">
                      <div className="stat-title text-[10px] uppercase font-bold tracking-wider">Token Dikonsumsi</div>
                      <div className="stat-value text-xl text-secondary mt-1">{aiStats.total_tokens.toLocaleString()}</div>
                      <div className="stat-desc text-[10px] opacity-75 mt-0.5">
                        In: {aiStats.input_tokens.toLocaleString()} | Out: {aiStats.output_tokens.toLocaleString()}
                      </div>
                    </div>
                    <div className="stat p-2">
                      <div className="stat-title text-[10px] uppercase font-bold tracking-wider">Batas Kuota Jam Ini</div>
                      <div className="stat-value text-xl text-accent mt-1">{aiStats.hourly_calls} / {aiStats.hourly_limit}</div>
                      <div className="mt-2 w-full bg-base-300 h-1.5 rounded-full overflow-hidden">
                        <div 
                          className={`h-full ${aiStats.hourly_calls > 40 ? 'bg-error' : aiStats.hourly_calls > 25 ? 'bg-warning' : 'bg-success'}`}
                          style={{ width: `${Math.min(100, (aiStats.hourly_calls / aiStats.hourly_limit) * 100)}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>

                  <form onSubmit={handleSaveAiSettings} className="space-y-4">
                    <div className="form-control">
                      <label className="label cursor-pointer justify-start gap-4 p-0">
                        <input 
                          type="checkbox" 
                          className="toggle toggle-primary toggle-sm"
                          checked={aiSettings.is_active}
                          onChange={e => setAiSettings({ ...aiSettings, is_active: e.target.checked })}
                        />
                        <div>
                          <span className="label-text font-semibold">Aktifkan Layanan Asisten AI</span>
                          <p className="text-xs text-base-content/50">Saat dinonaktifkan, semua fitur bertenaga AI di dalam aplikasi akan disembunyikan.</p>
                        </div>
                      </label>
                    </div>

                    {aiSettings.is_active && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                        {/* Kolom Kiri: API Configuration */}
                        <div className="space-y-4 p-4 bg-base-200/30 rounded-xl border border-base-300">
                          <h3 className="font-bold text-xs uppercase tracking-wider text-base-content/70">Konfigurasi API</h3>
                          
                          <div className="form-control w-full">
                            <label className="label py-1">
                              <span className="label-text text-xs font-semibold">Penyedia AI (AI Provider)</span>
                            </label>
                            <select 
                              className="select select-sm select-bordered w-full"
                              value={aiSettings.provider}
                              onChange={e => {
                                const prov = e.target.value;
                                setAiSettings({ 
                                  ...aiSettings, 
                                  provider: prov, 
                                  model: prov === 'gemini' ? 'gemini-1.5-flash' : 'gpt-4o' 
                                });
                              }}
                            >
                              <option value="openai">OpenAI (ChatGPT)</option>
                              <option value="gemini">Google Gemini</option>
                            </select>
                          </div>

                          <div className="form-control w-full">
                            <label className="label py-1">
                              <span className="label-text text-xs font-semibold">Model</span>
                            </label>
                            <input 
                              type="text" 
                              className="input input-sm input-bordered w-full font-mono"
                              value={aiSettings.model}
                              onChange={e => setAiSettings({ ...aiSettings, model: e.target.value })}
                              placeholder={aiSettings.provider === 'gemini' ? 'gemini-1.5-flash' : 'gpt-4o'}
                              required
                            />
                            <label className="label py-0.5">
                              <span className="label-text-alt text-[10px] text-base-content/50">
                                {aiSettings.provider === 'gemini' 
                                  ? 'Rekomendasi: gemini-1.5-flash, gemini-1.5-pro' 
                                  : 'Rekomendasi: gpt-4o, gpt-4o-mini'}
                              </span>
                            </label>
                          </div>

                          <div className="form-control w-full">
                            <label className="label py-1">
                              <span className="label-text text-xs font-semibold">API Key</span>
                            </label>
                            <input 
                              type="password" 
                              className="input input-sm input-bordered w-full font-mono"
                              value={aiSettings.api_key}
                              onChange={e => setAiSettings({ ...aiSettings, api_key: e.target.value })}
                              placeholder="Masukkan API Key baru..."
                              required
                            />
                            <label className="label py-0.5">
                              <span className="label-text-alt text-[10px] text-base-content/50">
                                Keamanan Terjamin. API Key dienkripsi menggunakan AES-256 sebelum disimpan.
                              </span>
                            </label>
                          </div>
                        </div>

                        {/* Kolom Kanan: Parameters & Features */}
                        <div className="space-y-4 p-4 bg-base-200/30 rounded-xl border border-base-300">
                          <h3 className="font-bold text-xs uppercase tracking-wider text-base-content/70">Parameter & Fitur</h3>

                          <div className="form-control w-full">
                            <div className="flex justify-between items-center py-1">
                              <span className="label-text text-xs font-semibold">Temperatur (Kreativitas)</span>
                              <span className="badge badge-neutral badge-sm font-mono">{aiSettings.temperature}</span>
                            </div>
                            <input 
                              type="range" 
                              min="0" 
                              max="1.5" 
                              step="0.1" 
                              className="range range-primary range-xs w-full"
                              value={aiSettings.temperature}
                              onChange={e => setAiSettings({ ...aiSettings, temperature: parseFloat(e.target.value) })}
                            />
                            <div className="flex justify-between text-[9px] px-1 text-base-content/40 mt-1">
                              <span>Faktual & Konsisten (0.0)</span>
                              <span>Kreatif (1.5)</span>
                            </div>
                          </div>

                          <div className="form-control w-full">
                            <label className="label py-1">
                              <span className="label-text text-xs font-semibold">Maksimal Token (Max Tokens)</span>
                            </label>
                            <input 
                              type="number" 
                              min="50" 
                              max="2000"
                              className="input input-sm input-bordered w-full"
                              value={aiSettings.max_tokens}
                              onChange={e => setAiSettings({ ...aiSettings, max_tokens: parseInt(e.target.value, 10) || 500 })}
                              required
                            />
                          </div>

                          <div className="form-control">
                            <label className="label py-1">
                              <span className="label-text text-xs font-semibold">Fitur yang Diaktifkan</span>
                            </label>
                            <div className="space-y-2 mt-1">
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input 
                                  type="checkbox" 
                                  className="checkbox checkbox-xs checkbox-primary"
                                  checked={aiSettings.features_enabled.includes('smart_reply')}
                                  onChange={() => handleFeatureToggle('smart_reply')}
                                />
                                <span className="text-xs">Smart Reply (Saran balasan cepat)</span>
                              </label>
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input 
                                  type="checkbox" 
                                  className="checkbox checkbox-xs checkbox-primary"
                                  checked={aiSettings.features_enabled.includes('summarize')}
                                  onChange={() => handleFeatureToggle('summarize')}
                                />
                                <span className="text-xs">Summarization (Ringkasan obrolan panjang)</span>
                              </label>
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input 
                                  type="checkbox" 
                                  className="checkbox checkbox-xs checkbox-primary"
                                  checked={aiSettings.features_enabled.includes('auto_categorize')}
                                  onChange={() => handleFeatureToggle('auto_categorize')}
                                />
                                <span className="text-xs">Auto-categorization (Saran label tiket otomatis)</span>
                              </label>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="flex justify-end mt-4">
                      <button 
                        type="submit" 
                        className={`btn btn-sm btn-primary ${savingAi ? 'loading' : ''}`}
                        disabled={savingAi}
                      >
                        Simpan Pengaturan AI
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'webhooks' && <WebhookManagement />}
        {activeTab === 'automation' && <AutomationManagement />}
        {activeTab === 'templates' && <MessageTemplateManagement />}
        {activeTab === 'apikeys' && <ApiKeyManagement />}
      </div>

      <ConfirmModal
        isOpen={deleteConfirmId !== null}
        title="Hapus Template"
        message="Apakah Anda yakin ingin menghapus template balasan cepat ini? Tindakan ini tidak dapat dibatalkan."
        confirmText="Ya, Hapus"
        variant="error"
        onConfirm={() => {
          if (deleteConfirmId !== null) executeDelete(deleteConfirmId);
        }}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </div>
  );
};

export default Settings;