import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { useToastStore } from '../store/toastStore';

interface ApiKey {
  id: number;
  key_prefix: string;
  name: string;
  permissions: string[];
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

const AVAILABLE_PERMISSIONS = [
  { id: 'read:conversations', label: 'Membaca Percakapan' },
  { id: 'write:messages', label: 'Mengirim Pesan' },
  { id: 'read:contacts', label: 'Membaca Kontak' },
  { id: 'write:contacts', label: 'Membuat/Mengubah Kontak' }
];

export const ApiKeyManagement = () => {
  const { token, user } = useAuthStore();
  const { addToast } = useToastStore();
  
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  
  // Form State
  const [name, setName] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  
  // New Key Modal
  const [newKey, setNewKey] = useState<string | null>(null);
  
  const [revokeConfirmId, setRevokeConfirmId] = useState<number | null>(null);

  const fetchKeys = async () => {
    if (!token) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/api-keys`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const result = await response.json();
      if (response.ok && result.success) {
        setKeys(result.data);
      }
    } catch (err) {
      console.error('Failed to fetch API keys', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, [token]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (!name.trim()) return addToast('Nama integrasi harus diisi', 'error');

    setIsCreating(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name,
          permissions: selectedPermissions
        })
      });
      const result = await response.json();
      if (response.ok && result.success) {
        addToast('API Key berhasil dibuat', 'success');
        setNewKey(result.data.plaintext_key);
        setName('');
        setSelectedPermissions([]);
        fetchKeys();
      } else {
        addToast(result.error || 'Gagal membuat API Key', 'error');
      }
    } catch (err) {
      addToast('Terjadi kesalahan', 'error');
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevoke = async (id: number) => {
    if (!token) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/api-keys/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        addToast('API Key telah dicabut', 'success');
        setRevokeConfirmId(null);
        fetchKeys();
      } else {
        const result = await response.json();
        addToast(result.error || 'Gagal mencabut API Key', 'error');
      }
    } catch (err) {
      addToast('Terjadi kesalahan saat mencabut', 'error');
    }
  };

  const handleCopy = () => {
    if (newKey) {
      navigator.clipboard.writeText(newKey);
      addToast('API Key disalin ke clipboard', 'success');
    }
  };

  if (user?.role !== 'administrator') {
    return <div className="p-8 text-center opacity-50">Hanya administrator yang dapat mengakses API Keys.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="card bg-base-100 shadow-sm border border-base-300">
        <div className="card-body">
          <h2 className="card-title text-lg mb-2">Buat API Key Baru</h2>
          <p className="text-sm opacity-70 mb-4">API Key memungkinkan sistem eksternal untuk mengakses fitur platform ini secara terprogram.</p>
          
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="form-control">
              <label className="label"><span className="label-text font-semibold">Nama Integrasi</span></label>
              <input 
                type="text" 
                className="input input-bordered w-full max-w-md" 
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Misal: Zapier, CRM Internal"
                required
              />
            </div>

            <div className="form-control">
              <label className="label"><span className="label-text font-semibold">Cakupan Izin (Scopes)</span></label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1 max-w-2xl">
                {AVAILABLE_PERMISSIONS.map(p => (
                  <label key={p.id} className="flex items-center gap-2 cursor-pointer p-2 border border-base-300 rounded-lg hover:bg-base-200/50 transition-colors">
                    <input 
                      type="checkbox" 
                      className="checkbox checkbox-sm checkbox-primary"
                      checked={selectedPermissions.includes(p.id)}
                      onChange={e => {
                        if (e.target.checked) {
                          setSelectedPermissions([...selectedPermissions, p.id]);
                        } else {
                          setSelectedPermissions(selectedPermissions.filter(id => id !== p.id));
                        }
                      }}
                    />
                    <span className="text-sm">{p.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <button type="submit" className={`btn btn-primary mt-4 ${isCreating ? 'loading' : ''}`} disabled={isCreating}>
              Buat API Key
            </button>
          </form>
        </div>
      </div>

      <div className="card bg-base-100 shadow-sm border border-base-300">
        <div className="card-body">
          <h2 className="card-title text-lg mb-4">Daftar API Key</h2>
          
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Nama Integrasi</th>
                  <th>Prefix Key</th>
                  <th>Scopes</th>
                  <th>Terakhir Digunakan</th>
                  <th className="text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="text-center py-8"><span className="loading loading-spinner"></span></td></tr>
                ) : keys.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-8 opacity-50">Belum ada API Key</td></tr>
                ) : (
                  keys.map(key => (
                    <tr key={key.id} className={key.revoked_at ? 'opacity-50' : ''}>
                      <td className="font-semibold">
                        {key.name}
                        {key.revoked_at && <span className="badge badge-error badge-xs ml-2">Revoked</span>}
                      </td>
                      <td className="font-mono text-xs">{key.key_prefix}...</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {key.permissions.length === 0 ? (
                            <span className="text-xs opacity-50">Tidak ada izin</span>
                          ) : (
                            key.permissions.map(p => <span key={p} className="badge badge-neutral badge-sm text-[10px]">{p}</span>)
                          )}
                        </div>
                      </td>
                      <td className="text-xs">
                        {key.last_used_at ? new Date(key.last_used_at).toLocaleString('id-ID') : 'Belum pernah'}
                      </td>
                      <td className="text-right">
                        {!key.revoked_at && (
                          <button 
                            className="btn btn-xs btn-error btn-outline"
                            onClick={() => setRevokeConfirmId(key.id)}
                          >
                            Cabut
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* New Key Display Modal */}
      {newKey && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg text-success">API Key Berhasil Dibuat!</h3>
            <div className="alert alert-warning mt-4 text-xs">
              <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              <span>Simpan API Key ini di tempat yang aman. Kami tidak akan menampilkannya lagi.</span>
            </div>
            
            <div className="mt-6">
              <label className="label"><span className="label-text">Secret API Key:</span></label>
              <div className="flex gap-2">
                <input type="text" readOnly value={newKey} className="input input-bordered w-full font-mono text-sm" />
                <button className="btn btn-primary" onClick={handleCopy}>Copy</button>
              </div>
            </div>
            
            <div className="modal-action">
              <button className="btn" onClick={() => setNewKey(null)}>Saya Sudah Menyimpannya</button>
            </div>
          </div>
        </div>
      )}

      {/* Revoke Confirmation Modal */}
      {revokeConfirmId && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg text-error">Cabut API Key?</h3>
            <p className="py-4 text-sm">Tindakan ini tidak dapat dibatalkan. Setiap sistem yang masih menggunakan API Key ini akan langsung mendapatkan penolakan akses (401 Unauthorized).</p>
            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setRevokeConfirmId(null)}>Batal</button>
              <button className="btn btn-error" onClick={() => handleRevoke(revokeConfirmId)}>Ya, Cabut Key</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
