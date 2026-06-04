import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';

interface Props {
  onUpdate: (newName: string, newEmail: string) => void;
}

const ContactInfo = ({ onUpdate }: Props) => {
  const { token } = useAuthStore();
  const { selectedConv } = useChatStore();

  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '' });
  const [isSaving, setIsSaving] = useState(false);

  const [availableLabels, setAvailableLabels] = useState<any[]>([]);
  const [conversationLabels, setConversationLabels] = useState<any[]>([]);
  const [showLabelMenu, setShowLabelMenu] = useState(false);

  useEffect(() => {
    if (selectedConv) {
      setFormData({ 
        name: selectedConv.name || '', 
        email: selectedConv.email || '' 
      });
      setIsEditing(false);

      if (token) {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
        fetch(`${apiUrl}/api/labels`, { headers: { 'Authorization': `Bearer ${token}` } })
          .then(res => res.json())
          .then(result => setAvailableLabels(result.data || []))
          .catch(console.error);

        fetch(`${apiUrl}/api/conversations/${selectedConv.id}/labels`, { headers: { 'Authorization': `Bearer ${token}` } })
          .then(res => res.json())
          .then(result => setConversationLabels(result.data || []))
          .catch(console.error);
      }
    }
  }, [selectedConv, token]);

  const addLabel = async (labelId: number) => {
    if (!token || !selectedConv) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      await fetch(`${apiUrl}/api/conversations/${selectedConv.id}/labels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ label_id: labelId })
      });
      const label = availableLabels.find(l => l.id === labelId);
      if (label) setConversationLabels(prev => [...prev, label]);
    } catch (e) {
      console.error(e);
    }
  };

  const removeLabel = async (labelId: number) => {
    if (!token || !selectedConv) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      await fetch(`${apiUrl}/api/conversations/${selectedConv.id}/labels/${labelId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setConversationLabels(prev => prev.filter(l => l.id !== labelId));
    } catch (e) {
      console.error(e);
    }
  };

  if (!selectedConv) return null;

  const handleSave = async () => {
    if (!token) return;
    setIsSaving(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/contacts/${selectedConv.contact_id}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify(formData)
      });
      
      if (response.ok) {
        setIsEditing(false);
        onUpdate(formData.name, formData.email); // Beritahu App.tsx data yang baru
      } else {
        alert('Gagal memperbarui kontak');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="w-72 bg-base-100 border-l border-base-300 flex flex-col h-full shrink-0 overflow-visible relative z-20">
      
      {/* Header Info Dinamis */}
      <div className="p-6 flex flex-col items-center border-b border-base-200 relative shrink-0">
        {!isEditing && (
          <button 
            className="btn btn-xs btn-ghost absolute top-2 right-2" 
            onClick={() => setIsEditing(true)}
            title="Edit Kontak"
          >
            ✏️
          </button>
        )}
        <div className="avatar placeholder mb-4 shadow-md rounded-full">
          <div className="bg-neutral text-neutral-content rounded-full w-24">
            <span className="text-3xl">
              {selectedConv.name.substring(0, 2).toUpperCase()}
            </span>
          </div>
        </div>
        
        {isEditing ? (
          <div className="w-full flex flex-col gap-2">
            <input 
              type="text" 
              className="input input-sm input-bordered w-full text-center" 
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              placeholder="Nama Kontak"
            />
            <input 
              type="email" 
              className="input input-sm input-bordered w-full text-center" 
              value={formData.email}
              onChange={e => setFormData({ ...formData, email: e.target.value })}
              placeholder="Email (Opsional)"
            />
            <div className="flex gap-1 mt-2">
              <button className="btn btn-xs flex-1 btn-ghost" onClick={() => setIsEditing(false)}>Batal</button>
              <button className={`btn btn-xs flex-1 btn-primary ${isSaving ? 'loading' : ''}`} onClick={handleSave}>Simpan</button>
            </div>
          </div>
        ) : (
          <>
            <h2 className="font-bold text-xl text-center truncate w-full px-2">
              {selectedConv.name}
            </h2>
            <p className="text-xs text-base-content/60 mt-1 font-mono">
              ID Tiket: #TKT-{String(selectedConv.id).padStart(4, '0')}
            </p>
          </>
        )}
      </div>

      {/* Detail Attributes */}
      <div className="p-4 space-y-4 flex-1 overflow-y-auto overflow-x-visible">
        
        {!isEditing && formData.email && (
          <div>
            <label className="text-[10px] font-bold text-base-content/40 uppercase tracking-wider">Email</label>
            <p className="text-sm mt-1 bg-base-200 p-2 rounded-lg truncate">
              {formData.email}
            </p>
          </div>
        )}

        <div>
          <label className="text-[10px] font-bold text-base-content/40 uppercase tracking-wider">Alamat WhatsApp (JID)</label>
          <p className="text-[10px] mt-1 bg-base-200 p-2 rounded-lg font-mono text-primary break-all">
            {selectedConv.phone}
          </p>
        </div>

        <div>
          <label className="text-[10px] font-bold text-base-content/40 uppercase tracking-wider">Status Saluran</label>
          <div className="flex items-center gap-2 mt-2">
            <div className="badge badge-success badge-xs"></div>
            <span className="text-xs font-medium">WhatsApp Terhubung</span>
          </div>
        </div>

        {/* Labels Section */}
        <div className="pt-2">
          <label className="text-[10px] font-bold text-base-content/40 uppercase tracking-wider mb-2 block">Labels</label>
          <div className="flex flex-wrap gap-1">
            {conversationLabels.length === 0 && (
              <span className="text-xs italic opacity-50 block w-full mb-1">Belum ada label</span>
            )}
            {conversationLabels.map(label => (
              <span
                key={label.id}
                className="badge badge-sm gap-1"
                style={{ backgroundColor: label.color, color: '#fff', border: 'none' }}
              >
                {label.title}
                <button onClick={() => removeLabel(label.id)} className="btn btn-ghost btn-xs px-1 hover:bg-black/20">×</button>
              </span>
            ))}
            {/* Inline list untuk menambah label */}
            <button 
              className={`badge badge-sm cursor-pointer border-dashed hover:bg-base-200 ${showLabelMenu ? 'badge-primary' : 'badge-outline'}`}
              onClick={() => setShowLabelMenu(!showLabelMenu)}
            >
              {showLabelMenu ? 'Tutup' : '+ Tambah'}
            </button>
          </div>
          
          {showLabelMenu && (
            <ul className="menu menu-xs bg-base-200 rounded-box w-full mt-2 shadow-sm border border-base-300">
              {availableLabels.length === 0 ? (
                <li className="text-xs p-2 opacity-50 italic text-center">Tidak ada label tersedia</li>
              ) : (
                availableLabels
                  .filter(l => !conversationLabels.some(cl => cl.id === l.id))
                  .map(label => (
                    <li key={label.id}>
                      <a onClick={() => { addLabel(label.id); setShowLabelMenu(false); }} className="flex items-center gap-2 py-2">
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: label.color }} />
                        {label.title}
                      </a>
                    </li>
                  ))
              )}
              {availableLabels.length > 0 && availableLabels.filter(l => !conversationLabels.some(cl => cl.id === l.id)).length === 0 && (
                 <li className="text-xs p-2 opacity-50 italic text-center">Semua label terpasang</li>
              )}
            </ul>
          )}
        </div>

        <div className="divider opacity-10"></div>
        
        <div className="px-2">
          <button className="btn btn-sm btn-block btn-outline btn-error opacity-70">Blokir Kontak</button>
        </div>
        
      </div>
      
    </div>
  );
};

export default ContactInfo;