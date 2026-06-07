import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import { useToastStore } from '../store/toastStore';

interface Props {
  onUpdate: (newName: string, newEmail: string) => void;
}

const ContactInfo = ({ onUpdate }: Props) => {
  const { token } = useAuthStore();
  const { selectedConv } = useChatStore();

  const { addToast } = useToastStore();

  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '' });
  const [isSaving, setIsSaving] = useState(false);

  const [availableLabels, setAvailableLabels] = useState<any[]>([]);
  const [conversationLabels, setConversationLabels] = useState<any[]>([]);
  const [showLabelMenu, setShowLabelMenu] = useState(false);
  const [aiRecommendedLabels, setAiRecommendedLabels] = useState<any[]>([]);
  const [loadingAiLabels, setLoadingAiLabels] = useState(false);

  const fetchAiLabels = async () => {
    if (!token || !selectedConv) return;
    setLoadingAiLabels(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/ai/categorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ conversation_id: Number(selectedConv.id) })
      });
      const result = await response.json();
      if (response.ok && result.success) {
        setAiRecommendedLabels(result.data || []);
      } else {
        addToast(result.error || 'Gagal menyarankan label', 'error');
      }
    } catch (err) {
      console.error(err);
      addToast('Gagal menghubungi server', 'error');
    } finally {
      setLoadingAiLabels(false);
    }
  };

  useEffect(() => {
    setAiRecommendedLabels([]);
  }, [selectedConv?.id]);

  // Contact Merging States
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [similarContacts, setSimilarContacts] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedSecondary, setSelectedSecondary] = useState<any | null>(null);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [isMerging, setIsMerging] = useState(false);

  // Fetch similar contacts when modal opens
  useEffect(() => {
    if (showMergeModal && selectedConv && token) {
      setLoadingSimilar(true);
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      fetch(`${apiUrl}/api/contacts/${selectedConv.contact_id}/similar`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(result => {
          if (result.success) {
            setSimilarContacts(result.data || []);
          }
        })
        .catch(console.error)
        .finally(() => setLoadingSimilar(false));
    } else {
      setSimilarContacts([]);
      setSearchQuery('');
      setSearchResults([]);
      setSelectedSecondary(null);
    }
  }, [showMergeModal, selectedConv, token]);

  const handleSearchContacts = async () => {
    if (!selectedConv || !searchQuery.trim() || !token) return;
    setLoadingSearch(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/contacts?q=${encodeURIComponent(searchQuery)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const result = await response.json();
        const filtered = (result.data || []).filter((c: any) => c.id !== selectedConv.contact_id);
        setSearchResults(filtered);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingSearch(false);
    }
  };

  const handleExecuteMerge = async () => {
    if (!selectedSecondary || !selectedConv || !token) return;
    setIsMerging(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/contacts/merge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          primary_id: selectedConv.contact_id,
          secondary_id: selectedSecondary.id
        })
      });
      if (response.ok) {
        addToast('Kontak berhasil digabungkan!', 'success');
        setShowMergeModal(false);
        const { setSelectedConv, triggerRefresh } = useChatStore.getState();
        setSelectedConv(null);
        triggerRefresh();
      } else {
        const err = await response.json();
        addToast(`Gagal menggabungkan: ${err.error || 'Terjadi kesalahan'}`, 'error');
      }
    } catch (e) {
      console.error(e);
      addToast('Gagal menghubungi server', 'error');
    } finally {
      setIsMerging(false);
    }
  };

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
            <button 
              className={`badge badge-sm cursor-pointer border-dashed hover:bg-base-200 text-primary gap-1 ${loadingAiLabels ? 'opacity-50 cursor-not-allowed' : ''}`}
              onClick={fetchAiLabels}
              disabled={loadingAiLabels}
            >
              {loadingAiLabels ? 'Loading...' : '✨ Saran AI'}
            </button>
          </div>

          {aiRecommendedLabels.length > 0 && (
            <div className="mt-3 p-2 bg-base-200/50 rounded-lg border border-base-300">
              <span className="text-[10px] font-bold text-base-content/50 uppercase tracking-wider block mb-1">Rekomendasi Label AI:</span>
              <div className="flex flex-wrap gap-1">
                {aiRecommendedLabels
                  .filter(rec => !conversationLabels.some(cl => cl.id === rec.id))
                  .map(rec => (
                    <button
                      key={rec.id}
                      onClick={() => {
                        addLabel(rec.id);
                        setAiRecommendedLabels(prev => prev.filter(p => p.id !== rec.id));
                      }}
                      className="badge badge-sm cursor-pointer hover:scale-105 transition-all text-white font-medium gap-1"
                      style={{ backgroundColor: availableLabels.find(al => al.id === rec.id)?.color || '#3b82f6', border: 'none' }}
                      title={`Confidence: ${Math.round(rec.confidence * 100)}%`}
                    >
                      ✨ {rec.title} ({Math.round(rec.confidence * 100)}%)
                    </button>
                  ))}
                {aiRecommendedLabels.filter(rec => !conversationLabels.some(cl => cl.id === rec.id)).length === 0 && (
                  <span className="text-[10px] italic opacity-50">Saran label sudah terpasang</span>
                )}
              </div>
            </div>
          )}
          
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
        
        <div className="px-2 space-y-2">
          <button 
            type="button" 
            className="btn btn-sm btn-block btn-outline btn-primary"
            onClick={() => setShowMergeModal(true)}
          >
            🤝 Gabungkan Kontak
          </button>
          <button className="btn btn-sm btn-block btn-outline btn-error opacity-70">Blokir Kontak</button>
        </div>
        
      </div>
      
      {showMergeModal && (
        <div className="modal modal-open">
          <div className="modal-box max-w-lg bg-base-100 border border-base-300 shadow-2xl rounded-2xl p-6">
            <h3 className="font-bold text-lg flex items-center gap-2 text-primary">
              🤝 Gabungkan Kontak Duplikat
            </h3>
            <p className="text-xs text-base-content/60 mt-1">
              Satukan dua kontak yang serupa menjadi satu kontak utama untuk merapikan riwayat percakapan.
            </p>

            <div className="divider my-4"></div>

            {/* Step 1: Select Secondary Contact */}
            {!selectedSecondary ? (
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-base-content/50 uppercase tracking-wider">
                    Kontak Utama (Data yang Dipertahankan)
                  </label>
                  <div className="flex items-center gap-3 bg-primary/10 border border-primary/20 p-3 rounded-xl">
                    <div className="avatar placeholder">
                      <div className="bg-primary text-primary-content rounded-full w-10">
                        <span className="text-sm font-bold">{selectedConv.name.substring(0,2).toUpperCase()}</span>
                      </div>
                    </div>
                    <div>
                      <h4 className="font-bold text-sm">{selectedConv.name}</h4>
                      <p className="text-xs opacity-75 font-mono">{selectedConv.phone}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-base-content/50 uppercase tracking-wider block">
                    Cari Kontak Sekunder (Akan Digabungkan & Dihapus)
                  </label>
                  <div className="flex gap-2">
                    <input 
                      type="text"
                      className="input input-sm input-bordered flex-1"
                      placeholder="Nama atau nomor WA..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSearchContacts()}
                    />
                    <button 
                      type="button" 
                      className={`btn btn-sm btn-primary ${loadingSearch ? 'loading' : ''}`}
                      onClick={handleSearchContacts}
                    >
                      Cari
                    </button>
                  </div>
                </div>

                {/* Similar Contacts Suggestion */}
                <div>
                  <h4 className="text-xs font-semibold text-base-content/70 mb-2">Kontak yang Serupa (Saran)</h4>
                  {loadingSimilar ? (
                    <div className="flex justify-center py-4">
                      <span className="loading loading-spinner loading-sm text-primary"></span>
                    </div>
                  ) : similarContacts.length === 0 ? (
                    <p className="text-xs italic opacity-50 text-center py-2 bg-base-200/50 rounded-xl">Tidak ada saran kontak serupa</p>
                  ) : (
                    <div className="flex flex-col gap-2 max-h-40 overflow-y-auto">
                      {similarContacts.map(c => (
                        <div 
                          key={c.id}
                          className="flex justify-between items-center bg-base-200/50 hover:bg-base-200 p-2.5 rounded-xl border border-base-300 transition-colors cursor-pointer"
                          onClick={() => setSelectedSecondary(c)}
                        >
                          <div>
                            <h5 className="font-semibold text-xs">{c.name}</h5>
                            <p className="text-[10px] opacity-70 font-mono">{c.phone_number}</p>
                          </div>
                          <span className="badge badge-sm badge-outline text-[10px] font-bold text-primary">Pilih</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Search Results */}
                {searchResults.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-base-content/70 mb-2">Hasil Pencarian</h4>
                    <div className="flex flex-col gap-2 max-h-40 overflow-y-auto">
                      {searchResults.map(c => (
                        <div 
                          key={c.id}
                          className="flex justify-between items-center bg-base-200/50 hover:bg-base-200 p-2.5 rounded-xl border border-base-300 transition-colors cursor-pointer"
                          onClick={() => setSelectedSecondary(c)}
                        >
                          <div>
                            <h5 className="font-semibold text-xs">{c.name}</h5>
                            <p className="text-[10px] opacity-70 font-mono">{c.phone_number}</p>
                          </div>
                          <span className="badge badge-sm badge-outline text-[10px] font-bold text-primary">Pilih</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              // Step 2: Confirm Merge
              <div className="space-y-4">
                <div className="bg-warning/10 border border-warning/20 p-4 rounded-xl text-xs text-warning-content space-y-1">
                  <p className="font-bold flex items-center gap-1">⚠️ Perhatian Sebelum Melanjutkan:</p>
                  <p>Seluruh riwayat pesan, tiket chat, dan CSAT rating dari <strong>{selectedSecondary.name}</strong> akan dipindahkan ke <strong>{selectedConv.name}</strong>.</p>
                  <p>Kontak <strong>{selectedSecondary.name}</strong> akan di-soft-delete dan tidak akan muncul lagi di sistem.</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-base-200/50 p-3 rounded-xl border border-base-300 flex flex-col items-center text-center">
                    <span className="text-[10px] font-bold text-base-content/40 uppercase mb-2">Kontak Sekunder (Dihapus)</span>
                    <div className="avatar placeholder mb-2">
                      <div className="bg-error/10 text-error rounded-full w-10">
                        <span className="text-xs font-bold">{selectedSecondary.name.substring(0,2).toUpperCase()}</span>
                      </div>
                    </div>
                    <h5 className="font-semibold text-xs truncate w-full">{selectedSecondary.name}</h5>
                    <p className="text-[10px] opacity-60 font-mono">{selectedSecondary.phone_number}</p>
                  </div>

                  <div className="bg-base-200/50 p-3 rounded-xl border border-base-300 flex flex-col items-center text-center">
                    <span className="text-[10px] font-bold text-base-content/40 uppercase mb-2">Kontak Utama (Dipertahankan)</span>
                    <div className="avatar placeholder mb-2">
                      <div className="bg-success/10 text-success rounded-full w-10">
                        <span className="text-xs font-bold">{selectedConv.name.substring(0,2).toUpperCase()}</span>
                      </div>
                    </div>
                    <h5 className="font-semibold text-xs truncate w-full">{selectedConv.name}</h5>
                    <p className="text-[10px] opacity-60 font-mono">{selectedConv.phone}</p>
                  </div>
                </div>

                <div className="flex justify-between items-center bg-base-200 p-3 rounded-xl text-xs">
                  <span>Atribut Kustom</span>
                  <span className="font-semibold text-success">Akan Digabungkan</span>
                </div>
              </div>
            )}

            <div className="modal-action gap-2">
              <button 
                type="button" 
                className="btn btn-sm btn-ghost" 
                onClick={() => setShowMergeModal(false)}
                disabled={isMerging}
              >
                Batal
              </button>
              {selectedSecondary && (
                <button 
                  type="button" 
                  className="btn btn-sm btn-outline" 
                  onClick={() => setSelectedSecondary(null)}
                  disabled={isMerging}
                >
                  Kembali
                </button>
              )}
              {selectedSecondary && (
                <button 
                  type="button" 
                  className={`btn btn-sm btn-primary ${isMerging ? 'loading' : ''}`}
                  onClick={handleExecuteMerge}
                  disabled={isMerging}
                >
                  Konfirmasi Gabung
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ContactInfo;