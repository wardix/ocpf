import React, { useState, useEffect } from 'react';
import UserManagement from './UserManagement';

interface CannedResponse {
  id: number;
  short_code: string;
  content: string;
}

interface Props {
  token: string | null;
}

const Settings = ({ token }: Props) => {
  const [cannedResponses, setCannedResponses] = useState<CannedResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState<number | null>(null);
  const [formData, setFormData] = useState({ short_code: '', content: '' });

  const fetchCanned = async () => {
    if (!token) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/canned-responses`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setCannedResponses(data);
      }
    } catch (err) {
      console.error('Gagal mengambil canned responses:', err);
    }
  };

  useEffect(() => {
    fetchCanned();
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

  const handleDelete = async (id: number) => {
    if (!token || !window.confirm('Yakin ingin menghapus template ini?')) return;
    
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
                          <button onClick={() => handleDelete(item.id)} className="btn btn-xs btn-outline btn-error">Hapus</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;ngs;