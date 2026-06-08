import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { useToastStore } from '../store/toastStore';
import { ConfirmModal } from './ConfirmModal';

interface MessageTemplate {
  id: number;
  name: string;
  body: string;
  variables: string[];
  category: string | null;
  language: string;
  usage_count: number;
  created_at: string;
}

const MessageTemplateManagement = () => {
  const { token } = useAuthStore();
  const { addToast } = useToastStore();
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState<number | null>(null);
  const [formData, setFormData] = useState({ name: '', body: '', category: '', language: 'id' });
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const fetchTemplates = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const q = searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : '';
      const response = await fetch(`${apiUrl}/api/message-templates${q}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const result = await response.json();
      if (response.ok && result.success) {
        setTemplates(result.data);
      }
    } catch (err) {
      addToast('Gagal mengambil data template pesan', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, [token, searchQuery]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const url = isEditing 
        ? `${apiUrl}/api/message-templates/${isEditing}`
        : `${apiUrl}/api/message-templates`;
      
      const method = isEditing ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });

      const result = await response.json();
      if (response.ok && result.success) {
        addToast(`Template pesan berhasil ${isEditing ? 'diperbarui' : 'ditambahkan'}`, 'success');
        setFormData({ name: '', body: '', category: '', language: 'id' });
        setIsEditing(null);
        fetchTemplates();
      } else {
        addToast(result.error || 'Gagal menyimpan template pesan', 'error');
      }
    } catch (err) {
      addToast('Terjadi kesalahan jaringan', 'error');
    }
  };

  const handleEdit = (template: MessageTemplate) => {
    setIsEditing(template.id);
    setFormData({
      name: template.name,
      body: template.body,
      category: template.category || '',
      language: template.language || 'id'
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async () => {
    if (!deleteConfirmId || !token) return;

    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/message-templates/${deleteConfirmId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const result = await response.json();
      
      if (response.ok && result.success) {
        addToast('Template pesan berhasil dihapus', 'success');
        fetchTemplates();
      } else {
        addToast(result.error || 'Gagal menghapus template pesan', 'error');
      }
    } catch (err) {
      addToast('Terjadi kesalahan jaringan', 'error');
    } finally {
      setDeleteConfirmId(null);
    }
  };

  // Syntax highlighting for {{variables}}
  const renderHighlightedBody = (body: string) => {
    const parts = body.split(/(\{\{[^}]+\}\})/g);
    return parts.map((part, i) => {
      if (part.startsWith('{{') && part.endsWith('}}')) {
        return <span key={i} className="text-primary font-mono bg-primary/10 px-1 rounded">{part}</span>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="space-y-6">
      <div className="card bg-base-100 shadow border border-base-200">
        <div className="card-body">
          <h2 className="card-title text-lg mb-4">{isEditing ? 'Edit Template Pesan' : 'Tambah Template Pesan Baru'}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="form-control w-full">
                <label className="label"><span className="label-text font-medium">Nama Template</span></label>
                <input 
                  type="text" 
                  className="input input-bordered w-full" 
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  required
                  placeholder="Misal: Sapaan Pagi"
                />
              </div>
              <div className="form-control w-full">
                <label className="label"><span className="label-text font-medium">Kategori (Opsional)</span></label>
                <input 
                  type="text" 
                  className="input input-bordered w-full" 
                  value={formData.category}
                  onChange={(e) => setFormData({...formData, category: e.target.value})}
                  placeholder="Misal: Greeting, Support"
                />
              </div>
            </div>

            <div className="form-control w-full">
              <label className="label">
                <span className="label-text font-medium">Isi Template</span>
                <span className="label-text-alt text-base-content/60">Gunakan {'{{variabel}}'} untuk placeholder dinamis</span>
              </label>
              <textarea 
                className="textarea textarea-bordered w-full h-32" 
                value={formData.body}
                onChange={(e) => setFormData({...formData, body: e.target.value})}
                required
                placeholder="Halo {{contact.name}}, pesanan Anda dengan nomor {{order_id}} sudah diproses."
              ></textarea>
              <label className="label">
                <span className="label-text-alt text-success">Variabel otomatis yang didukung: {'{{contact.name}}, {{contact.email}}, {{contact.phone}}'}</span>
              </label>
            </div>

            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary">
                {isEditing ? 'Simpan Perubahan' : 'Tambah Template'}
              </button>
              {isEditing && (
                <button type="button" className="btn btn-ghost" onClick={() => {
                  setIsEditing(null);
                  setFormData({ name: '', body: '', category: '', language: 'id' });
                }}>
                  Batal
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      <div className="card bg-base-100 shadow border border-base-200">
        <div className="card-body">
          <div className="flex justify-between items-center mb-4">
            <h2 className="card-title text-lg">Daftar Template Pesan</h2>
            <div className="form-control">
              <input 
                type="text" 
                placeholder="Cari nama atau isi..." 
                className="input input-bordered input-sm w-64" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Nama & Kategori</th>
                  <th>Isi Pesan</th>
                  <th>Penggunaan</th>
                  <th className="text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={4} className="text-center py-8"><span className="loading loading-spinner"></span></td></tr>
                ) : templates.length === 0 ? (
                  <tr><td colSpan={4} className="text-center py-8 text-base-content/60">Belum ada template pesan yang ditambahkan.</td></tr>
                ) : (
                  templates.map((template) => (
                    <tr key={template.id}>
                      <td className="align-top">
                        <div className="font-bold">{template.name}</div>
                        {template.category && <div className="badge badge-ghost badge-sm mt-1">{template.category}</div>}
                      </td>
                      <td className="whitespace-pre-wrap max-w-md align-top text-sm">
                        {renderHighlightedBody(template.body)}
                      </td>
                      <td className="align-top">
                        <div className="badge badge-info badge-sm">{template.usage_count} kali</div>
                      </td>
                      <td className="text-right align-top">
                        <button className="btn btn-sm btn-ghost" onClick={() => handleEdit(template)}>Edit</button>
                        <button className="btn btn-sm btn-ghost text-error" onClick={() => setDeleteConfirmId(template.id)}>Hapus</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={deleteConfirmId !== null}
        title="Hapus Template"
        message="Apakah Anda yakin ingin menghapus template pesan ini? Data yang sudah dihapus tidak dapat dikembalikan."
        confirmText="Ya, Hapus"
        variant="error"
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </div>
  );
};

export default MessageTemplateManagement;
