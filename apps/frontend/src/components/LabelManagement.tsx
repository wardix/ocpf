import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { ConfirmModal } from './ConfirmModal';

interface Label {
  id: number;
  title: string;
  color: string;
  conversations_count: number;
}

const LabelManagement = () => {
  const { token, user } = useAuthStore();
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState<number | null>(null);
  const [formData, setFormData] = useState({ title: '', color: '#3abff8' });
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const fetchLabels = async () => {
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
    } catch (err) {
      console.error('Gagal mengambil daftar label:', err);
    }
  };

  useEffect(() => {
    fetchLabels();
  }, [token]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (!formData.title.trim()) return;

    setLoading(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const method = isEditing ? 'PATCH' : 'POST';
      const endpoint = isEditing ? `/api/labels/${isEditing}` : '/api/labels';

      const response = await fetch(`${apiUrl}${endpoint}`, {
        method,
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ title: formData.title.toLowerCase().trim(), color: formData.color })
      });

      if (response.ok) {
        setFormData({ title: '', color: '#3abff8' });
        setIsEditing(null);
        fetchLabels();
      } else {
        const data = await response.json();
        alert(data.error || 'Gagal menyimpan label');
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
      const response = await fetch(`${apiUrl}/api/labels/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        fetchLabels();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const handleEdit = (item: Label) => {
    setIsEditing(item.id);
    setFormData({ title: item.title, color: item.color });
  };

  if (user?.role !== 'administrator') return null;

  return (
    <div className="card bg-base-100 shadow-sm border border-base-300 mt-8">
      <div className="card-body">
        <h2 className="card-title text-xl mb-4">Labels (Kategori Tiket)</h2>
        
        <form onSubmit={handleSave} className="flex flex-col gap-4 bg-base-200/50 p-4 rounded-xl border border-base-300">
          <h3 className="font-semibold text-sm text-base-content/70">
            {isEditing ? '✏️ Edit Label' : '➕ Tambah Label Baru'}
          </h3>
          <div className="flex gap-4 items-end">
            <div className="form-control w-1/3">
              <label className="label"><span className="label-text text-xs">Nama Label</span></label>
              <input 
                type="text" 
                placeholder="misal: complaint" 
                className="input input-sm input-bordered w-full" 
                value={formData.title}
                onChange={e => setFormData({ ...formData, title: e.target.value })}
                required
              />
            </div>
            <div className="form-control w-1/4">
              <label className="label"><span className="label-text text-xs">Warna (Hex)</span></label>
              <div className="flex gap-2">
                <input 
                  type="color" 
                  className="h-8 w-12 cursor-pointer rounded" 
                  value={formData.color}
                  onChange={e => setFormData({ ...formData, color: e.target.value })}
                  required
                />
                <input 
                  type="text" 
                  className="input input-sm input-bordered w-full font-mono text-xs uppercase" 
                  value={formData.color}
                  onChange={e => setFormData({ ...formData, color: e.target.value })}
                  pattern="^#[0-9A-Fa-f]{6}$"
                />
              </div>
            </div>
            <div className="flex-1 flex gap-2 justify-end">
              {isEditing && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setIsEditing(null); setFormData({ title: '', color: '#3abff8' }); }}>Batal</button>
              )}
              <button type="submit" className={`btn btn-sm btn-primary ${loading ? 'loading' : ''}`}>
                Simpan Label
              </button>
            </div>
          </div>
        </form>

        <div className="overflow-x-auto mt-6">
          <table className="table table-sm table-zebra w-full border border-base-200">
            <thead className="bg-base-200">
              <tr>
                <th>Warna</th>
                <th>Nama Label</th>
                <th className="text-center">Digunakan di Percakapan</th>
                <th className="w-32 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {labels.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center italic opacity-50 py-4">Belum ada label.</td>
                </tr>
              )}
              {labels.map(item => (
                <tr key={item.id}>
                  <td>
                    <div className="w-6 h-6 rounded-md shadow-sm border border-black/10" style={{ backgroundColor: item.color }} title={item.color}></div>
                  </td>
                  <td className="font-bold">{item.title}</td>
                  <td className="text-center font-mono opacity-70">{item.conversations_count}</td>
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

      </div>

      <ConfirmModal
        isOpen={deleteConfirmId !== null}
        title="Hapus Label"
        message="Apakah Anda yakin ingin menghapus label ini? Ini akan mencabut label dari semua percakapan terkait."
        confirmText="Ya, Hapus Label"
        variant="error"
        onConfirm={() => {
          if (deleteConfirmId !== null) executeDelete(deleteConfirmId);
        }}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </div>
  );
};

export default LabelManagement;