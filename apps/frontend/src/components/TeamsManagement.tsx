import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { useToastStore } from '../store/toastStore';

interface Team {
  id: number;
  name: string;
  description: string;
  members: { id: number; name: string; role: string }[];
}

interface User {
  id: number;
  name: string;
}

interface Label {
  id: number;
  title: string;
  color: string;
}

interface RoutingRule {
  id: number;
  label_id: number;
  title: string;
  color: string;
}

export const TeamsManagement = () => {
  const { token, user } = useAuthStore();
  const { addToast } = useToastStore();

  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);

  const [isCreating, setIsCreating] = useState(false);
  const [createData, setCreateData] = useState({ name: '', description: '' });

  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedLabelId, setSelectedLabelId] = useState<string>('');
  const [routingRules, setRoutingRules] = useState<RoutingRule[]>([]);

  const fetchTeams = useCallback(async () => {
    if (!token) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/teams`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const result = await response.json();
        setTeams(result.data || []);
      }
    } catch (e) {
      console.error('Error fetching teams', e);
    }
  }, [token]);

  const fetchUsers = useCallback(async () => {
    if (!token) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/users`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        setUsers(await response.json());
      }
    } catch (e) {
      console.error('Error fetching users', e);
    }
  }, [token]);

  const fetchLabels = useCallback(async () => {
    if (!token) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/labels`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const result = await response.json();
        setLabels(result.data || []);
      }
    } catch (e) {
      console.error('Error fetching labels', e);
    }
  }, [token]);

  const fetchRoutingRules = useCallback(async () => {
    if (!token || !selectedTeamId) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/teams/${selectedTeamId}/routing`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const result = await response.json();
        setRoutingRules(result.data || []);
      }
    } catch (e) {
      console.error('Error fetching routing rules', e);
    }
  }, [token, selectedTeamId]);

  useEffect(() => {
    fetchTeams();
    fetchUsers();
    fetchLabels();
  }, [fetchTeams, fetchUsers, fetchLabels]);

  useEffect(() => {
    fetchRoutingRules();
  }, [fetchRoutingRules]);

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/teams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(createData)
      });
      if (response.ok) {
        addToast('Tim berhasil dibuat', 'success');
        setCreateData({ name: '', description: '' });
        setIsCreating(false);
        fetchTeams();
      } else {
        const err = await response.json();
        addToast(`Gagal: ${err.error}`, 'error');
      }
    } catch (e) {
      addToast('Gagal membuat tim', 'error');
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !selectedTeamId || !selectedUserId) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/teams/${selectedTeamId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ user_id: Number(selectedUserId), role: 'member' })
      });
      if (response.ok) {
        addToast('Anggota berhasil ditambahkan', 'success');
        setSelectedUserId('');
        fetchTeams();
      }
    } catch (e) {
      addToast('Gagal menambah anggota', 'error');
    }
  };

  const handleRemoveMember = async (userId: number) => {
    if (!token || !selectedTeamId) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/teams/${selectedTeamId}/members/${userId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        addToast('Anggota dihapus', 'success');
        fetchTeams();
      }
    } catch (e) {
      addToast('Gagal menghapus anggota', 'error');
    }
  };

  const handleAddRouting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !selectedTeamId || !selectedLabelId) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/teams/${selectedTeamId}/routing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ label_id: Number(selectedLabelId) })
      });
      if (response.ok) {
        addToast('Aturan routing berhasil ditambahkan', 'success');
        setSelectedLabelId('');
        fetchRoutingRules();
      }
    } catch (e) {
      addToast('Gagal menambah routing', 'error');
    }
  };

  const handleRemoveRouting = async (labelId: number) => {
    if (!token || !selectedTeamId) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/teams/${selectedTeamId}/routing/${labelId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        addToast('Aturan routing dihapus', 'success');
        fetchRoutingRules();
      }
    } catch (e) {
      addToast('Gagal menghapus routing', 'error');
    }
  };

  const selectedTeam = teams.find(t => t.id === selectedTeamId);
  const nonMembers = users.filter(u => !selectedTeam?.members.some(m => m.id === u.id));

  return (
    <div className="card bg-base-100 shadow-sm border border-base-300">
      <div className="card-body">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="card-title text-xl">👥 Manajemen Tim (Departemen)</h2>
            <p className="text-sm text-base-content/60">Kelola tim, anggota, dan routing otomatis berdasarkan label.</p>
          </div>
          {!isCreating && (
            <button className="btn btn-sm btn-primary" onClick={() => setIsCreating(true)}>➕ Tambah Tim</button>
          )}
        </div>

        {isCreating && (
          <form onSubmit={handleCreateTeam} className="bg-base-200/50 p-4 rounded-xl border border-base-300 mb-6 flex flex-col gap-4">
            <div className="form-control">
              <label className="label"><span className="label-text text-xs">Nama Tim</span></label>
              <input type="text" className="input input-sm input-bordered" value={createData.name} onChange={e => setCreateData({ ...createData, name: e.target.value })} required />
            </div>
            <div className="form-control">
              <label className="label"><span className="label-text text-xs">Deskripsi</span></label>
              <input type="text" className="input input-sm input-bordered" value={createData.description} onChange={e => setCreateData({ ...createData, description: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setIsCreating(false)}>Batal</button>
              <button type="submit" className="btn btn-sm btn-primary">Simpan</button>
            </div>
          </form>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 border-r border-base-200 pr-0 lg:pr-4">
            <h3 className="font-semibold text-xs text-base-content/50 uppercase mb-2">Daftar Tim</h3>
            <div className="space-y-2">
              {teams.length === 0 ? <p className="text-sm italic opacity-50">Belum ada tim</p> : teams.map(team => (
                <div key={team.id} onClick={() => setSelectedTeamId(team.id)} className={`p-3 rounded-xl border cursor-pointer ${selectedTeamId === team.id ? 'border-primary bg-primary/5' : 'border-base-300'}`}>
                  <div className="font-bold">{team.name}</div>
                  <div className="text-xs opacity-60">{team.members.length} Anggota</div>
                </div>
              ))}
            </div>
          </div>

          {selectedTeam && (
            <div className="lg:col-span-2 flex flex-col gap-6">
              <div>
                <h3 className="font-semibold text-base mb-3">Anggota Tim: {selectedTeam.name}</h3>
                <form onSubmit={handleAddMember} className="flex gap-2 mb-4">
                  <select className="select select-sm select-bordered flex-1" value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)} required>
                    <option value="" disabled>-- Pilih Agen --</option>
                    {nonMembers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                  <button type="submit" className="btn btn-sm btn-primary">Tambah</button>
                </form>
                <div className="bg-base-100 border border-base-200 rounded-lg overflow-hidden">
                  <table className="table table-sm">
                    <thead><tr><th>Nama</th><th>Peran</th><th>Aksi</th></tr></thead>
                    <tbody>
                      {selectedTeam.members.map(m => (
                        <tr key={m.id}>
                          <td>{m.name}</td>
                          <td><span className="badge badge-sm">{m.role}</span></td>
                          <td><button className="btn btn-xs btn-error btn-ghost" onClick={() => handleRemoveMember(m.id)}>Hapus</button></td>
                        </tr>
                      ))}
                      {selectedTeam.members.length === 0 && <tr><td colSpan={3} className="text-center italic opacity-50">Tidak ada anggota</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-base mb-3">Auto-Routing Label</h3>
                <p className="text-xs opacity-70 mb-3">Otomatis berikan tiket ke tim ini jika label berikut ditambahkan.</p>
                <form onSubmit={handleAddRouting} className="flex gap-2 mb-4">
                  <select className="select select-sm select-bordered flex-1" value={selectedLabelId} onChange={e => setSelectedLabelId(e.target.value)} required>
                    <option value="" disabled>-- Pilih Label --</option>
                    {labels.filter(l => !routingRules.some(r => r.label_id === l.id)).map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
                  </select>
                  <button type="submit" className="btn btn-sm btn-secondary">Tambah Routing</button>
                </form>
                <div className="flex flex-wrap gap-2">
                  {routingRules.map(r => (
                    <div key={r.id} className="badge badge-lg gap-2" style={{ backgroundColor: r.color, color: '#fff' }}>
                      {r.title}
                      <button onClick={() => handleRemoveRouting(r.label_id)} className="hover:opacity-70">✕</button>
                    </div>
                  ))}
                  {routingRules.length === 0 && <span className="text-xs italic opacity-50">Belum ada aturan routing</span>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
