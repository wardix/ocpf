import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  created_at: string;
}

const UserManagement = () => {
  const { token } = useAuthStore();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '', password: '', role: 'agent' });

  const fetchUsers = async () => {
    if (!token) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/users`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setUsers(data);
      }
    } catch (err) {
      console.error('Gagal mengambil data agen:', err);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [token]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setLoading(true);
    
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/users`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        setFormData({ name: '', email: '', password: '', role: 'agent' });
        setIsAdding(false);
        fetchUsers();
      } else {
        const errData = await response.json();
        alert(errData.error || 'Gagal menambahkan agen');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card bg-base-100 shadow-sm border border-base-300">
      <div className="card-body">
        <div className="flex justify-between items-center mb-4">
          <h2 className="card-title text-xl">Manajemen Agen</h2>
          {!isAdding && (
            <button className="btn btn-sm btn-primary" onClick={() => setIsAdding(true)}>
              ➕ Tambah Agen
            </button>
          )}
        </div>
        
        {isAdding && (
          <form onSubmit={handleSave} className="flex flex-col gap-4 bg-base-200/50 p-4 rounded-xl border border-base-300 mb-6">
            <h3 className="font-semibold text-sm text-base-content/70">➕ Tambah Agen Baru</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="form-control">
                <label className="label"><span className="label-text text-xs">Nama Lengkap</span></label>
                <input 
                  type="text" 
                  className="input input-sm input-bordered w-full" 
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div className="form-control">
                <label className="label"><span className="label-text text-xs">Email Login</span></label>
                <input 
                  type="email" 
                  className="input input-sm input-bordered w-full" 
                  value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })}
                  required
                />
              </div>
              <div className="form-control">
                <label className="label"><span className="label-text text-xs">Password Sementara</span></label>
                <input 
                  type="password" 
                  className="input input-sm input-bordered w-full" 
                  value={formData.password}
                  onChange={e => setFormData({ ...formData, password: e.target.value })}
                  required
                  minLength={6}
                />
              </div>
              <div className="form-control">
                <label className="label"><span className="label-text text-xs">Hak Akses (Role)</span></label>
                <select 
                  className="select select-sm select-bordered w-full"
                  value={formData.role}
                  onChange={e => setFormData({ ...formData, role: e.target.value })}
                >
                  <option value="agent">Agent Biasa</option>
                  <option value="administrator">Administrator</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setIsAdding(false)}>Batal</button>
              <button type="submit" className={`btn btn-sm btn-primary ${loading ? 'loading' : ''}`} disabled={loading}>
                Simpan Akun
              </button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="table table-sm table-zebra w-full border border-base-200">
            <thead className="bg-base-200">
              <tr>
                <th>ID</th>
                <th>Nama</th>
                <th>Email</th>
                <th>Jabatan</th>
                <th>Terdaftar</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center italic opacity-50 py-4">Memuat daftar agen...</td>
                </tr>
              )}
              {users.map(u => (
                <tr key={u.id}>
                  <td className="font-mono text-xs opacity-50">{u.id}</td>
                  <td className="font-bold">{u.name}</td>
                  <td>{u.email}</td>
                  <td>
                    <div className={`badge badge-sm ${u.role === 'administrator' ? 'badge-primary' : 'badge-ghost'}`}>
                      {u.role}
                    </div>
                  </td>
                  <td className="text-xs">{new Date(u.created_at).toLocaleDateString('id-ID')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
};

export default UserManagement;