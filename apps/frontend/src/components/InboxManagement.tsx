import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { useToastStore } from '../store/toastStore';

interface Inbox {
  id: number;
  name: string;
  description: string | null;
  greeting_message: string | null;
  is_active: boolean;
  members_count?: number;
  open_tickets_count?: number;
}

interface Member {
  id: number;
  name: string;
  email: string;
  role: string;
}

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
}

interface Props {
  inboxes: Inbox[];
  activeInboxId: number | null;
  setActiveInboxId: (id: number | null) => void;
  onRefreshInboxes: () => void;
}

const InboxManagement = ({ inboxes, activeInboxId, setActiveInboxId, onRefreshInboxes }: Props) => {
  const { token } = useAuthStore();
  const { addToast } = useToastStore();
  
  const [members, setMembers] = useState<Member[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [selectedUserIdToAdd, setSelectedUserIdToAdd] = useState<string>('');
  
  // Create Inbox Form State
  const [isCreating, setIsCreating] = useState(false);
  const [createData, setCreateData] = useState({ name: '', description: '', greeting_message: '' });
  const [savingNewInbox, setSavingNewInbox] = useState(false);

  // Edit Inbox Form State
  const [editData, setEditData] = useState({ 
    name: '', 
    description: '', 
    greeting_message: '', 
    is_active: true,
    widget_config: {
      theme_color: '#0284c7',
      position: 'right',
      bubble_label: 'Chat',
      allowed_domains: ''
    }
  });
  const [savingEdit, setSavingEdit] = useState(false);

  // Get active inbox object
  const activeInbox = inboxes.find(i => i.id === activeInboxId) || null;

  // Sync edit form with active inbox
  useEffect(() => {
    if (activeInbox) {
      const config = (activeInbox as any).widget_config || {};
      setEditData({
        name: activeInbox.name,
        description: activeInbox.description || '',
        greeting_message: activeInbox.greeting_message || '',
        is_active: activeInbox.is_active,
        widget_config: {
          theme_color: config.theme_color || '#0284c7',
          position: config.position || 'right',
          bubble_label: config.bubble_label || 'Chat',
          allowed_domains: config.allowed_domains || ''
        }
      });
    }
  }, [activeInboxId, inboxes]);

  // Fetch members of selected inbox
  const fetchMembers = useCallback(async () => {
    if (!token || !activeInboxId) return;
    setLoadingMembers(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/inboxes/${activeInboxId}/members`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setMembers(result.data);
        }
      }
    } catch (e) {
      console.error('Failed to fetch inbox members:', e);
    } finally {
      setLoadingMembers(false);
    }
  }, [token, activeInboxId]);

  // Fetch all users to be able to add them
  const fetchAllUsers = useCallback(async () => {
    if (!token) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/users`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setAllUsers(data);
      }
    } catch (e) {
      console.error('Failed to fetch users:', e);
    }
  }, [token]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  useEffect(() => {
    fetchAllUsers();
  }, [fetchAllUsers]);

  const handleCreateInbox = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSavingNewInbox(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/inboxes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(createData)
      });
      if (response.ok) {
        const result = await response.json();
        addToast('Inbox baru berhasil dibuat', 'success');
        setCreateData({ name: '', description: '', greeting_message: '' });
        setIsCreating(false);
        onRefreshInboxes();
        if (result.data?.id) {
          setActiveInboxId(result.data.id);
        }
      } else {
        const err = await response.json();
        addToast(`Gagal: ${err.error || 'Terjadi kesalahan'}`, 'error');
      }
    } catch (e) {
      console.error(e);
      addToast('Gagal menghubungi server', 'error');
    } finally {
      setSavingNewInbox(false);
    }
  };

  const handleSaveInboxEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !activeInboxId) return;
    setSavingEdit(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/inboxes/${activeInboxId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(editData)
      });
      if (response.ok) {
        addToast('Inbox berhasil diperbarui', 'success');
        onRefreshInboxes();
      } else {
        const err = await response.json();
        addToast(`Gagal: ${err.error || 'Terjadi kesalahan'}`, 'error');
      }
    } catch (e) {
      console.error(e);
      addToast('Gagal memperbarui inbox', 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !activeInboxId || !selectedUserIdToAdd) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/inboxes/${activeInboxId}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ user_id: Number(selectedUserIdToAdd) })
      });
      if (response.ok) {
        addToast('Anggota berhasil ditambahkan ke inbox', 'success');
        setSelectedUserIdToAdd('');
        fetchMembers();
        onRefreshInboxes(); // Refresh members_count in parent
      } else {
        const err = await response.json();
        addToast(`Gagal: ${err.error || 'Terjadi kesalahan'}`, 'error');
      }
    } catch (e) {
      console.error(e);
      addToast('Gagal menambahkan anggota', 'error');
    }
  };

  const handleRemoveMember = async (userId: number) => {
    if (!token || !activeInboxId) return;
    if (!window.confirm('Apakah Anda yakin ingin menghapus anggota ini dari inbox?')) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/inboxes/${activeInboxId}/members/${userId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        addToast('Anggota berhasil dihapus dari inbox', 'success');
        fetchMembers();
        onRefreshInboxes(); // Refresh members_count in parent
      } else {
        const err = await response.json();
        addToast(`Gagal: ${err.error || 'Terjadi kesalahan'}`, 'error');
      }
    } catch (e) {
      console.error(e);
      addToast('Gagal menghapus anggota', 'error');
    }
  };

  // Filter out users who are already members
  const nonMemberUsers = allUsers.filter(u => !members.some(m => m.id === u.id));

  return (
    <div className="card bg-base-100 shadow-sm border border-base-300">
      <div className="card-body">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="card-title text-xl">📥 Manajemen Multi-Inbox</h2>
            <p className="text-sm text-base-content/60">
              Kelola beberapa saluran masuk dan tugaskan agen ke inbox tertentu.
            </p>
          </div>
          {!isCreating && (
            <button className="btn btn-sm btn-primary" onClick={() => setIsCreating(true)}>
              ➕ Tambah Inbox
            </button>
          )}
        </div>

        {/* Create Inbox Form */}
        {isCreating && (
          <form onSubmit={handleCreateInbox} className="flex flex-col gap-4 bg-base-200/50 p-4 rounded-xl border border-base-300 mb-6">
            <h3 className="font-semibold text-sm text-base-content/70">➕ Buat Inbox Baru</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="form-control">
                <label className="label"><span className="label-text text-xs">Nama Inbox</span></label>
                <input 
                  type="text" 
                  placeholder="Misal: Customer Support ID, Sales Team"
                  className="input input-sm input-bordered w-full" 
                  value={createData.name}
                  onChange={e => setCreateData({ ...createData, name: e.target.value })}
                  required
                />
              </div>
              <div className="form-control">
                <label className="label"><span className="label-text text-xs">Deskripsi Singkat</span></label>
                <input 
                  type="text" 
                  placeholder="Deskripsi fungsi inbox ini"
                  className="input input-sm input-bordered w-full" 
                  value={createData.description}
                  onChange={e => setCreateData({ ...createData, description: e.target.value })}
                />
              </div>
              <div className="form-control md:col-span-2">
                <label className="label">
                  <span className="label-text text-xs">Pesan Penyambung Otomatis (Greeting Message)</span>
                </label>
                <textarea 
                  placeholder="Pesan selamat datang otomatis yang dikirim ke pelanggan saat pertama kali chat..."
                  className="textarea textarea-sm textarea-bordered w-full h-16 resize-none" 
                  value={createData.greeting_message}
                  onChange={e => setCreateData({ ...createData, greeting_message: e.target.value })}
                ></textarea>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setIsCreating(false)}>Batal</button>
              <button type="submit" className={`btn btn-sm btn-primary ${savingNewInbox ? 'loading' : ''}`} disabled={savingNewInbox}>
                Simpan Inbox
              </button>
            </div>
          </form>
        )}

        {/* Selector & Details Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-2">
          {/* Inbox List Section */}
          <div className="lg:col-span-1 border-r border-base-200 pr-0 lg:pr-4">
            <h3 className="font-semibold text-xs text-base-content/50 uppercase tracking-wider mb-2">Daftar Inbox</h3>
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
              {inboxes.length === 0 ? (
                <p className="text-sm italic text-base-content/50">Belum ada inbox.</p>
              ) : (
                inboxes.map(inbox => (
                  <div 
                    key={inbox.id}
                    onClick={() => setActiveInboxId(inbox.id)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all hover:bg-base-200/50 flex flex-col gap-1 ${
                      activeInboxId === inbox.id 
                        ? 'border-primary bg-primary/5 shadow-sm' 
                        : 'border-base-300 bg-base-100'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <span className="font-bold text-sm flex items-center gap-1.5">
                        📥 {inbox.name}
                      </span>
                      <span className={`badge badge-xs text-[9px] ${inbox.is_active ? 'badge-success text-white' : 'badge-ghost'}`}>
                        {inbox.is_active ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </div>
                    {inbox.description && (
                      <p className="text-[11px] text-base-content/60 truncate">{inbox.description}</p>
                    )}
                    <div className="flex justify-between items-center text-[10px] text-base-content/50 mt-1">
                      <span>👥 {inbox.members_count || 0} Anggota</span>
                      <span>🎫 {inbox.open_tickets_count || 0} Tiket Aktif</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Inbox Detail Config & Members Section */}
          <div className="lg:col-span-2 space-y-6">
            {activeInbox ? (
              <>
                {/* Edit Inbox Form */}
                <form onSubmit={handleSaveInboxEdit} className="bg-base-200/40 p-4 rounded-xl border border-base-300 space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="font-bold text-sm text-base-content">
                      ⚙️ Konfigurasi Detail: <span className="text-primary">{activeInbox.name}</span>
                    </h3>
                    <div className="form-control">
                      <label className="label cursor-pointer gap-2 p-0">
                        <span className="label-text text-xs font-semibold">Status Inbox</span>
                        <input 
                          type="checkbox" 
                          className="toggle toggle-success toggle-xs"
                          checked={editData.is_active}
                          onChange={e => setEditData({ ...editData, is_active: e.target.checked })}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="form-control">
                      <label className="label"><span className="label-text text-xs">Nama Inbox</span></label>
                      <input 
                        type="text" 
                        className="input input-sm input-bordered w-full"
                        value={editData.name}
                        onChange={e => setEditData({ ...editData, name: e.target.value })}
                        required
                      />
                    </div>
                    <div className="form-control">
                      <label className="label"><span className="label-text text-xs">Deskripsi</span></label>
                      <input 
                        type="text" 
                        className="input input-sm input-bordered w-full"
                        value={editData.description}
                        onChange={e => setEditData({ ...editData, description: e.target.value })}
                      />
                    </div>
                    <div className="form-control md:col-span-2">
                      <label className="label">
                        <span className="label-text text-xs">Pesan Penyambung Otomatis (Greeting Message)</span>
                      </label>
                      <textarea 
                        className="textarea textarea-sm textarea-bordered w-full h-16 resize-none"
                        value={editData.greeting_message}
                        onChange={e => setEditData({ ...editData, greeting_message: e.target.value })}
                      ></textarea>
                    </div>
                  </div>

                  <div className="divider text-xs opacity-50">Kustomisasi Web Chat Widget</div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="form-control">
                      <label className="label"><span className="label-text text-xs">Warna Tema Widget</span></label>
                      <div className="flex gap-2 items-center">
                        <input 
                          type="color" 
                          className="w-8 h-8 rounded cursor-pointer border border-base-300"
                          value={editData.widget_config?.theme_color || '#0284c7'}
                          onChange={e => setEditData({
                            ...editData,
                            widget_config: {
                              ...editData.widget_config,
                              theme_color: (e.target as HTMLInputElement).value
                            }
                          })}
                        />
                        <input 
                          type="text" 
                          className="input input-xs input-bordered w-24 font-mono text-[11px]"
                          value={editData.widget_config?.theme_color || '#0284c7'}
                          onChange={e => setEditData({
                            ...editData,
                            widget_config: {
                              ...editData.widget_config,
                              theme_color: (e.target as HTMLInputElement).value
                            }
                          })}
                        />
                      </div>
                    </div>

                    <div className="form-control">
                      <label className="label"><span className="label-text text-xs">Posisi Widget</span></label>
                      <select 
                        className="select select-sm select-bordered w-full"
                        value={editData.widget_config?.position || 'right'}
                        onChange={e => setEditData({
                          ...editData,
                          widget_config: {
                            ...editData.widget_config,
                            position: (e.target as HTMLSelectElement).value
                          }
                        })}
                      >
                        <option value="right">Kanan Bawah (Bottom Right)</option>
                        <option value="left">Kiri Bawah (Bottom Left)</option>
                      </select>
                    </div>

                    <div className="form-control">
                      <label className="label"><span className="label-text text-xs">Label Tombol Bubble</span></label>
                      <input 
                        type="text" 
                        className="input input-sm input-bordered w-full"
                        value={editData.widget_config?.bubble_label || 'Chat'}
                        onChange={e => setEditData({
                          ...editData,
                          widget_config: {
                            ...editData.widget_config,
                            bubble_label: (e.target as HTMLInputElement).value
                          }
                        })}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 mt-2">
                    <div className="form-control">
                      <label className="label">
                        <span className="label-text text-xs font-semibold">Whitelist Domain (CORS)</span>
                      </label>
                      <input 
                        type="text" 
                        placeholder="mywebsite.com, shop.domain.id (kosongkan untuk mengizinkan semua domain)"
                        className="input input-sm input-bordered w-full font-mono text-xs"
                        value={editData.widget_config?.allowed_domains || ''}
                        onChange={e => setEditData({
                          ...editData,
                          widget_config: {
                            ...editData.widget_config,
                            allowed_domains: (e.target as HTMLInputElement).value
                          }
                        })}
                      />
                      <label className="label">
                        <span className="label-text-alt text-[10px] text-base-content/50">
                          Pisahkan beberapa domain dengan koma. Subdomain diizinkan secara otomatis (misal: domain.com mencakup *.domain.com).
                        </span>
                      </label>
                    </div>
                  </div>

                  <div className="form-control mt-2">
                    <label className="label">
                      <span className="label-text text-xs font-semibold">Kode Embed Script (Salin & Tempel di Website Anda)</span>
                    </label>
                    <div className="relative">
                      <textarea
                        readOnly
                        className="textarea textarea-sm textarea-bordered w-full font-mono bg-base-300 text-xs h-16 resize-none pr-16"
                        value={`<script src="${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/widget.js" data-inbox-id="${activeInboxId}" data-api-url="${import.meta.env.VITE_API_URL || 'http://localhost:3000'}"></script>`}
                        onClick={e => (e.target as HTMLTextAreaElement).select()}
                      ></textarea>
                      <button
                        type="button"
                        className="btn btn-xs btn-primary absolute top-2 right-2"
                        onClick={() => {
                          const code = `<script src="${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/widget.js" data-inbox-id="${activeInboxId}" data-api-url="${import.meta.env.VITE_API_URL || 'http://localhost:3000'}"></script>`;
                          navigator.clipboard.writeText(code);
                          addToast('Kode embed berhasil disalin ke clipboard', 'success');
                        }}
                      >
                        Salin
                      </button>
                    </div>
                  </div>

                  <div className="flex justify-end mt-4">
                    <button 
                      type="submit" 
                      className={`btn btn-xs btn-primary ${savingEdit ? 'loading' : ''}`}
                      disabled={savingEdit}
                    >
                      Perbarui Info & Widget
                    </button>
                  </div>
                </form>

                {/* Member Management Section */}
                <div className="bg-base-200/40 p-4 rounded-xl border border-base-300 space-y-4">
                  <h3 className="font-bold text-sm text-base-content flex justify-between items-center">
                    <span>👥 Anggota Tim Terdaftar ({members.length})</span>
                    <span className="text-[11px] text-base-content/50 normal-case font-normal">
                      Hanya anggota terdaftar yang dapat melihat & menjawab tiket dari inbox ini.
                    </span>
                  </h3>

                  {/* Add Member Form */}
                  <form onSubmit={handleAddMember} className="flex gap-2 items-end">
                    <div className="form-control flex-1">
                      <select 
                        className="select select-xs select-bordered w-full"
                        value={selectedUserIdToAdd}
                        onChange={e => setSelectedUserIdToAdd(e.target.value)}
                        required
                      >
                        <option value="">-- Pilih Agen untuk Ditambahkan --</option>
                        {nonMemberUsers.map(user => (
                          <option key={user.id} value={user.id}>
                            {user.name} ({user.role === 'administrator' ? 'Admin' : 'Agent'}) - {user.email}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button 
                      type="submit" 
                      className="btn btn-xs btn-primary font-semibold"
                      disabled={!selectedUserIdToAdd}
                    >
                      ➕ Tambah
                    </button>
                  </form>

                  {/* Members List Table */}
                  <div className="overflow-x-auto border border-base-300 rounded-lg">
                    {loadingMembers ? (
                      <div className="flex justify-center p-4">
                        <span className="loading loading-spinner loading-xs text-primary"></span>
                      </div>
                    ) : members.length === 0 ? (
                      <p className="text-center italic text-xs text-base-content/50 py-4">Belum ada anggota di inbox ini.</p>
                    ) : (
                      <table className="table table-xs table-zebra w-full">
                        <thead>
                          <tr>
                            <th>Nama</th>
                            <th>Email</th>
                            <th>Role</th>
                            <th className="w-12 text-center">Aksi</th>
                          </tr>
                        </thead>
                        <tbody>
                          {members.map(member => (
                            <tr key={member.id}>
                              <td className="font-semibold">{member.name}</td>
                              <td>{member.email}</td>
                              <td>
                                <span className={`badge badge-[10px] h-3.5 ${member.role === 'administrator' ? 'badge-primary' : 'badge-ghost'}`}>
                                  {member.role}
                                </span>
                              </td>
                              <td className="text-center">
                                <button 
                                  type="button"
                                  onClick={() => handleRemoveMember(member.id)}
                                  className="btn btn-[10px] h-4 min-h-0 px-1.5 btn-outline btn-error hover:text-white"
                                  title="Hapus dari inbox"
                                >
                                  Hapus
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-48 border-2 border-dashed border-base-300 rounded-xl opacity-60">
                <span className="text-4xl mb-2">📥</span>
                <p className="text-sm font-semibold">Silakan pilih inbox di samping kiri</p>
                <p className="text-xs">untuk mengelola konfigurasi dan daftar anggotanya.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default InboxManagement;
