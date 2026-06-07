import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { useToastStore } from '../store/toastStore';

interface Webhook {
  id: number;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
  description: string | null;
  created_at: string;
}

interface DeliveryLog {
  id: number;
  event_type: string;
  payload: any;
  response_status: number | null;
  response_body: string | null;
  attempt: number;
  delivered_at: string | null;
  error_message: string | null;
  created_at: string;
}

export default function WebhookManagement() {
  const { token, user } = useAuthStore();
  const { addToast } = useToastStore();
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(false);

  // Form State
  const [isEditing, setIsEditing] = useState<number | null>(null);
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [active, setActive] = useState(true);

  // Logs Overlay State
  const [selectedWebhook, setSelectedWebhook] = useState<Webhook | null>(null);
  const [logs, setLogs] = useState<DeliveryLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logsPage, setLogsPage] = useState(1);
  const [logsTotalPages, setLogsTotalPages] = useState(1);
  const [revealSecrets, setRevealSecrets] = useState<Record<number, boolean>>({});

  const allowedEvents = [
    { value: 'conversation.created', label: 'Percakapan Dibuat (conversation.created)' },
    { value: 'conversation.resolved', label: 'Percakapan Selesai (conversation.resolved)' },
    { value: 'message.incoming', label: 'Pesan Masuk (message.incoming)' },
    { value: 'message.outgoing', label: 'Pesan Keluar (message.outgoing)' },
    { value: 'contact.created', label: 'Kontak Baru Dibuat (contact.created)' }
  ];

  const fetchWebhooks = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/webhooks`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) setWebhooks(json.data);
      }
    } catch (e) {
      console.error('Error fetching webhooks:', e);
    } finally {
      setLoading(false);
    }
  }, [token, apiUrl]);

  const fetchLogs = useCallback(async (webhookId: number, pageNum: number) => {
    if (!token) return;
    setLoadingLogs(true);
    try {
      const res = await fetch(`${apiUrl}/api/webhooks/${webhookId}/deliveries?page=${pageNum}&limit=10`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setLogs(json.data);
          setLogsTotalPages(json.pagination.pages);
        }
      }
    } catch (e) {
      console.error('Error fetching webhook logs:', e);
    } finally {
      setLoadingLogs(false);
    }
  }, [token, apiUrl]);

  useEffect(() => {
    if (user?.role === 'administrator') {
      fetchWebhooks();
    }
  }, [fetchWebhooks, user]);

  const handleCheckboxChange = (eventVal: string) => {
    setSelectedEvents(prev =>
      prev.includes(eventVal)
        ? prev.filter(e => e !== eventVal)
        : [...prev, eventVal]
    );
  };

  const resetForm = () => {
    setIsEditing(null);
    setUrl('');
    setDescription('');
    setSelectedEvents([]);
    setActive(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    if (!url.trim()) {
      addToast('URL wajib diisi', 'error');
      return;
    }
    if (selectedEvents.length === 0) {
      addToast('Pilih minimal satu event trigger', 'error');
      return;
    }

    try {
      const endpoint = isEditing
        ? `${apiUrl}/api/webhooks/${isEditing}`
        : `${apiUrl}/api/webhooks`;

      const method = isEditing ? 'PUT' : 'POST';

      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          url,
          events: selectedEvents,
          active,
          description: description || null
        })
      });

      if (response.ok) {
        const json = await response.json();
        if (json.success) {
          addToast(isEditing ? 'Webhook berhasil diperbarui' : 'Webhook berhasil ditambahkan', 'success');
          resetForm();
          fetchWebhooks();
        } else {
          addToast(json.error || 'Gagal menyimpan webhook', 'error');
        }
      } else {
        const errJson = await response.json();
        addToast(errJson.error || 'Gagal menyimpan webhook', 'error');
      }
    } catch (err) {
      addToast('Kesalahan koneksi ke server', 'error');
    }
  };

  const handleEdit = (webhook: Webhook) => {
    setIsEditing(webhook.id);
    setUrl(webhook.url);
    setDescription(webhook.description || '');
    setSelectedEvents(webhook.events);
    setActive(webhook.active);
  };

  const handleDelete = async (id: number) => {
    if (!token) return;
    if (!confirm('Apakah Anda yakin ingin menghapus endpoint webhook ini?')) return;

    try {
      const res = await fetch(`${apiUrl}/api/webhooks/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        addToast('Webhook berhasil dihapus', 'success');
        fetchWebhooks();
        if (selectedWebhook?.id === id) setSelectedWebhook(null);
      }
    } catch (e) {
      addToast('Gagal menghapus webhook', 'error');
    }
  };

  const handleToggleActive = async (webhook: Webhook) => {
    if (!token) return;
    const newStatus = !webhook.active;

    try {
      const res = await fetch(`${apiUrl}/api/webhooks/${webhook.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          url: webhook.url,
          events: webhook.events,
          active: newStatus,
          description: webhook.description
        })
      });

      if (res.ok) {
        addToast(newStatus ? 'Webhook diaktifkan' : 'Webhook dinonaktifkan', 'success');
        fetchWebhooks();
      }
    } catch (e) {
      addToast('Gagal mengubah status webhook', 'error');
    }
  };

  const handleTestPing = async (id: number) => {
    if (!token) return;
    try {
      const res = await fetch(`${apiUrl}/api/webhooks/${id}/test`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        addToast('Test ping event berhasil dikirim ke antrean worker!', 'success');
      } else {
        addToast('Gagal mengirim test ping', 'error');
      }
    } catch (e) {
      addToast('Koneksi bermasalah', 'error');
    }
  };

  const openLogs = (webhook: Webhook) => {
    setSelectedWebhook(webhook);
    setLogsPage(1);
    fetchLogs(webhook.id, 1);
  };

  const toggleRevealSecret = (id: number) => {
    setRevealSecrets(prev => ({ ...prev, [id]: !prev[id] }));
  };

  if (user?.role !== 'administrator') return null;

  return (
    <div className="card bg-base-100 shadow-sm border border-base-300">
      <div className="card-body">
        <h2 className="card-title text-xl mb-1">🔌 Integrasi Outbound Webhook</h2>
        <p className="text-sm text-base-content/60 mb-6">
          Kirim notifikasi HTTP POST secara real-time ke aplikasi eksternal (CRM, ERP, Analytics) saat event tertentu terjadi di sistem.
        </p>

        {/* Form section */}
        <form onSubmit={handleSave} className="bg-base-200 p-5 rounded-xl border border-base-300 mb-6 space-y-4">
          <h3 className="font-bold text-sm">{isEditing ? '✏️ Edit Endpoint Webhook' : '➕ Tambah Endpoint Webhook Baru'}</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="form-control">
              <label className="label py-1"><span className="label-text text-xs font-semibold">URL Endpoint</span></label>
              <input
                type="url"
                placeholder="https://aplikasi-anda.com/webhook-receiver"
                className="input input-sm input-bordered w-full font-mono text-xs"
                value={url}
                onChange={e => setUrl(e.target.value)}
                required
              />
            </div>
            <div className="form-control">
              <label className="label py-1"><span className="label-text text-xs font-semibold">Deskripsi Singkat</span></label>
              <input
                type="text"
                placeholder="Integrasi CRM Toko Online"
                className="input input-sm input-bordered w-full text-xs"
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>
          </div>

          <div className="form-control">
            <label className="label py-1"><span className="label-text text-xs font-semibold">Event Triggers</span></label>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 mt-1 bg-base-100 p-3 rounded-lg border border-base-300">
              {allowedEvents.map(evt => (
                <label key={evt.value} className="flex items-center gap-2 cursor-pointer py-1">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-primary checkbox-xs"
                    checked={selectedEvents.includes(evt.value)}
                    onChange={() => handleCheckboxChange(evt.value)}
                  />
                  <span className="text-xs">{evt.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-between items-center pt-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                className="toggle toggle-success toggle-sm"
                checked={active}
                onChange={e => setActive(e.target.checked)}
              />
              <span className="text-xs font-semibold">Endpoint Aktif</span>
            </div>
            <div className="flex gap-2">
              {isEditing && (
                <button type="button" className="btn btn-xs btn-ghost" onClick={resetForm}>Batal</button>
              )}
              <button type="submit" className="btn btn-xs btn-primary">
                {isEditing ? 'Perbarui Webhook' : 'Simpan Webhook'}
              </button>
            </div>
          </div>
        </form>

        {/* Webhooks list table */}
        {loading ? (
          <div className="flex justify-center py-6">
            <span className="loading loading-spinner loading-md text-primary"></span>
          </div>
        ) : webhooks.length === 0 ? (
          <div className="text-center py-8 opacity-50 bg-base-200 rounded-xl border border-dashed border-base-300">
            <span className="text-3xl">🔌</span>
            <p className="text-xs mt-2">Belum ada endpoint Webhook terdaftar.</p>
          </div>
        ) : (
          <div className="overflow-x-auto border border-base-300 rounded-xl">
            <table className="table table-sm table-zebra w-full">
              <thead>
                <tr className="bg-base-200">
                  <th className="w-12">Status</th>
                  <th>URL & Deskripsi</th>
                  <th>Secret Signature Key</th>
                  <th>Events</th>
                  <th className="text-right w-64">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {webhooks.map(wh => (
                  <tr key={wh.id} className="hover">
                    <td>
                      <input
                        type="checkbox"
                        className="toggle toggle-success toggle-xs"
                        checked={wh.active}
                        onChange={() => handleToggleActive(wh)}
                      />
                    </td>
                    <td>
                      <div className="font-mono text-xs font-semibold text-primary truncate max-w-xs" title={wh.url}>
                        {wh.url}
                      </div>
                      {wh.description && (
                        <div className="text-[10px] opacity-65 mt-0.5">{wh.description}</div>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] bg-base-300 px-2 py-0.5 rounded text-base-content/85">
                          {revealSecrets[wh.id] ? wh.secret : '••••••••••••••••••••••••'}
                        </span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-circle btn-xs text-[10px]"
                          onClick={() => toggleRevealSecret(wh.id)}
                          title="Tampilkan/Sembunyikan Secret"
                        >
                          {revealSecrets[wh.id] ? '👁️' : '👁️‍🗨️'}
                        </button>
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1 max-w-[200px]">
                        {wh.events.map(e => (
                          <span key={e} className="badge badge-outline badge-xs text-[9px] font-semibold">{e}</span>
                        ))}
                      </div>
                    </td>
                    <td className="text-right space-x-1">
                      <button className="btn btn-xs btn-outline" onClick={() => handleTestPing(wh.id)}>Test Ping</button>
                      <button className="btn btn-xs btn-neutral" onClick={() => openLogs(wh)}>Riwayat Logs</button>
                      <button className="btn btn-xs btn-outline" onClick={() => handleEdit(wh)}>Edit</button>
                      <button className="btn btn-xs btn-error btn-outline" onClick={() => handleDelete(wh.id)}>Hapus</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Webhook Delivery Logs Overlay Modal */}
      {selectedWebhook && (
        <div className="modal modal-open">
          <div className="modal-box max-w-3xl h-[600px] flex flex-col p-5 bg-base-100 shadow-2xl rounded-2xl">
            <div className="flex justify-between items-center border-b border-base-300 pb-2 mb-3">
              <div className="flex flex-col">
                <h3 className="font-bold text-sm">📜 Riwayat Pengiriman Webhook</h3>
                <span className="text-[10px] opacity-60 font-mono truncate max-w-lg">{selectedWebhook.url}</span>
              </div>
              <button className="btn btn-xs btn-ghost" onClick={() => setSelectedWebhook(null)}>✕ Close</button>
            </div>

            <div className="flex-1 overflow-y-auto flex flex-col gap-3 p-2 bg-base-200 rounded-lg">
              {loadingLogs ? (
                <div className="flex justify-center items-center h-full">
                  <span className="loading loading-spinner loading-md text-primary"></span>
                </div>
              ) : logs.length === 0 ? (
                <div className="text-center py-12 opacity-50 text-xs">
                  Belum ada log pengiriman untuk endpoint ini.
                </div>
              ) : (
                logs.map(log => {
                  const isSuccess = log.response_status && log.response_status >= 200 && log.response_status < 300;
                  return (
                    <div key={log.id} className="bg-base-100 p-3 rounded-lg border border-base-300 space-y-2 text-xs shadow-sm">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <span className={`badge badge-sm font-semibold text-white ${isSuccess ? 'badge-success' : 'badge-error'}`}>
                            {log.response_status || 'Connection Error'}
                          </span>
                          <span className="font-mono font-bold text-xs">{log.event_type}</span>
                          <span className="opacity-50 text-[10px]">Percobaan #{log.attempt}</span>
                        </div>
                        <span className="opacity-50 text-[10px]">{new Date(log.created_at).toLocaleString()}</span>
                      </div>

                      {log.error_message && (
                        <div className="bg-red-500/10 text-red-500 p-2 rounded font-mono text-[11px] border border-red-500/20">
                          <strong>Error:</strong> {log.error_message}
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-semibold opacity-60">Event Payload:</span>
                          <pre className="bg-base-200 p-2 rounded text-[10px] font-mono overflow-x-auto max-h-24">
                            {JSON.stringify(log.payload, null, 2)}
                          </pre>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-semibold opacity-60">Response Body:</span>
                          <pre className="bg-base-200 p-2 rounded text-[10px] font-mono overflow-x-auto max-h-24 text-base-content/85">
                            {log.response_body || '(Kosong)'}
                          </pre>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Logs Pagination footer */}
            {logsTotalPages > 1 && (
              <div className="flex justify-center items-center gap-4 mt-4 pt-2 border-t border-base-200">
                <button
                  className="btn btn-xs btn-outline"
                  onClick={() => {
                    const prev = Math.max(1, logsPage - 1);
                    setLogsPage(prev);
                    fetchLogs(selectedWebhook.id, prev);
                  }}
                  disabled={logsPage === 1}
                >
                  « Prev
                </button>
                <span className="text-xs font-semibold">Halaman {logsPage} dari {logsTotalPages}</span>
                <button
                  className="btn btn-xs btn-outline"
                  onClick={() => {
                    const next = Math.min(logsTotalPages, logsPage + 1);
                    setLogsPage(next);
                    fetchLogs(selectedWebhook.id, next);
                  }}
                  disabled={logsPage === logsTotalPages}
                >
                  Next »
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
