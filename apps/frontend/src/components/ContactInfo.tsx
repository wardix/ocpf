import React, { useState, useEffect } from 'react';

interface SelectedConversation {
  id: number;
  contact_id: number;
  phone: string;
  name: string;
  email: string | null;
}

interface Props {
  selectedConv: SelectedConversation;
  token: string | null;
  onUpdate: (newName: string, newEmail: string) => void;
}

const ContactInfo = ({ selectedConv, token, onUpdate }: Props) => {
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '' });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setFormData({ 
      name: selectedConv.name || '', 
      email: selectedConv.email || '' 
    });
    setIsEditing(false);
  }, [selectedConv]);

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
    <div className="w-72 bg-base-100 border-l border-base-300 flex flex-col h-full shrink-0 overflow-y-auto">
      
      {/* Header Info Dinamis */}
      <div className="p-6 flex flex-col items-center border-b border-base-200 relative">
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
      <div className="p-4 space-y-4">
        
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

        {/* Labels (Bisa dikembangkan nanti agar dinamis dari DB) */}
        <div>
          <label className="text-[10px] font-bold text-base-content/40 uppercase tracking-wider">Label</label>
          <div className="flex flex-wrap gap-2 mt-2">
            <span className="badge badge-outline badge-sm opacity-50 italic text-[10px]">Belum ada label</span>
            <button className="btn btn-xs btn-ghost btn-outline border-dashed text-[9px]">
              + Tambah Label
            </button>
          </div>
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