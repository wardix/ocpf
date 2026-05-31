import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';

interface Contact {
  id: number;
  name: string;
  phone_number: string;
  email: string | null;
  created_at: string;
  total_tickets: number;
}

const Broadcast = () => {
  const { token } = useAuthStore();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedContactIds, setSelectedContactIds] = useState<number[]>([]);
  const [messageContent, setMessageContent] = useState('');
  const [isSending, setIsSending] = useState(false);

  const fetchContacts = async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/contacts?q=${encodeURIComponent(search)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setContacts(data);
      }
    } catch (err) {
      console.error('Gagal mengambil kontak:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      fetchContacts();
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [token, search]);

  const handleSelectAll = () => {
    if (selectedContactIds.length === contacts.length) {
      setSelectedContactIds([]);
    } else {
      setSelectedContactIds(contacts.map(c => c.id));
    }
  };

  const handleToggleSelect = (id: number) => {
    setSelectedContactIds(prev => 
      prev.includes(id) ? prev.filter(cId => cId !== id) : [...prev, id]
    );
  };

  const handleSendBroadcast = async () => {
    if (selectedContactIds.length === 0) {
      alert("Pilih minimal satu pelanggan.");
      return;
    }
    if (!messageContent.trim()) {
      alert("Pesan tidak boleh kosong.");
      return;
    }

    const confirm = window.confirm(`Kirim broadcast ini ke ${selectedContactIds.length} pelanggan?`);
    if (!confirm) return;

    setIsSending(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/broadcast`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({
          contact_ids: selectedContactIds,
          content: messageContent
        })
      });

      if (response.ok) {
        alert('Broadcast berhasil dimasukkan ke antrean pengiriman!');
        setMessageContent('');
        setSelectedContactIds([]);
      } else {
        const errData = await response.json();
        alert(errData.error || 'Gagal memproses broadcast');
      }
    } catch (err) {
      console.error('Gagal broadcast:', err);
      alert('Terjadi kesalahan jaringan.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-base-200/50 h-full p-8 overflow-y-auto">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold">Pesan Massal (Broadcast)</h1>
          <p className="text-base-content/60 mt-2">Kirim pesan pengumuman atau promosi ke pelanggan secara aman.</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 h-full">
        {/* Kolom Kiri: Tabel Pelanggan */}
        <div className="bg-base-100 rounded-2xl shadow-sm border border-base-300 flex-1 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-base-200 bg-base-100 flex justify-between items-center">
            <h2 className="font-bold text-lg">Pilih Target Pelanggan</h2>
            <input 
              type="text" 
              placeholder="Cari kontak..." 
              className="input input-sm input-bordered w-64" 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="overflow-x-auto flex-1">
            <table className="table w-full">
              <thead>
                <tr className="bg-base-200/50">
                  <th className="w-12">
                    <label>
                      <input 
                        type="checkbox" 
                        className="checkbox checkbox-sm" 
                        checked={contacts.length > 0 && selectedContactIds.length === contacts.length}
                        onChange={handleSelectAll}
                      />
                    </label>
                  </th>
                  <th>Nama Pelanggan</th>
                  <th>Nomor WhatsApp</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && contacts.length === 0 && (
                  <tr>
                    <td colSpan={3} className="text-center py-8 opacity-50">Memuat data kontak...</td>
                  </tr>
                )}
                {contacts.map((c) => (
                  <tr key={c.id} className="hover cursor-pointer" onClick={() => handleToggleSelect(c.id)}>
                    <th>
                      <label>
                        <input 
                          type="checkbox" 
                          className="checkbox checkbox-sm" 
                          checked={selectedContactIds.includes(c.id)}
                          onChange={() => handleToggleSelect(c.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </label>
                    </th>
                    <td>
                      <div className="font-bold">{c.name}</div>
                    </td>
                    <td className="font-mono text-primary text-sm">{c.phone_number}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-4 border-t border-base-200 bg-base-100 text-sm font-medium">
            Terpilih: {selectedContactIds.length} dari {contacts.length} kontak
          </div>
        </div>

        {/* Kolom Kanan: Editor Pesan */}
        <div className="w-full lg:w-96 bg-base-100 rounded-2xl shadow-sm border border-base-300 flex flex-col overflow-hidden shrink-0">
          <div className="p-4 border-b border-base-200 bg-base-100">
            <h2 className="font-bold text-lg">Tulis Pesan</h2>
          </div>
          <div className="p-4 flex-1 flex flex-col gap-4">
            <textarea 
              className="textarea textarea-bordered flex-1 w-full text-base resize-none focus:outline-primary/50" 
              placeholder="Ketik pesan broadcast Anda di sini...&#10;&#10;Contoh:&#10;Halo Kak, kami ada diskon khusus untuk Anda hari ini!"
              value={messageContent}
              onChange={e => setMessageContent(e.target.value)}
            ></textarea>
            
            <div className="bg-warning/20 p-4 rounded-xl border border-warning/50">
              <h3 className="font-bold text-warning text-sm flex items-center gap-2">
                <span>⚠️</span> Aturan Anti-Spam
              </h3>
              <p className="text-xs text-base-content/70 mt-1">
                Pesan akan dikirim menggunakan antrean lambat (1 pesan per detik) secara otomatis agar nomor Anda tidak diblokir oleh WhatsApp.
              </p>
            </div>
            
            <button 
              className={`btn btn-primary w-full shadow-lg ${isSending ? 'loading' : ''}`}
              onClick={handleSendBroadcast}
              disabled={isSending || selectedContactIds.length === 0 || !messageContent.trim()}
            >
              🚀 Kirim Broadcast Sekarang
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Broadcast;