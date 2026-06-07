import React, { useState, useEffect } from 'react';
import UserManagement from './UserManagement';
import LabelManagement from './LabelManagement';
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

  const fetchInboxSettings = async () => {
    if (!token) return;
    setLoadingSettings(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/inboxes/1/settings`, {
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
    if (!token) return;
    setSavingSettings(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/inboxes/1/settings`, {
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
    if (!token) return;
    setLoadingBh(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/inboxes/1/business-hours`, {
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
    if (!token) return;
    setSavingBh(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/inboxes/1/business-hours`, {
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
    fetchInboxSettings();
    fetchBusinessHours();
  }, [token]);

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

        <div className="card bg-base-100 shadow-sm border border-base-300">
          <div className="card-body">
            <h2 className="card-title text-xl mb-1">📬 Pengaturan Inbox & Auto-Assignment</h2>
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
            <h2 className="card-title text-xl mb-1">⏰ Jam Operasional & Auto-Responder</h2>
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

        <LabelManagement />
        <UserManagement />

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