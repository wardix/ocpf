import React, { useEffect, useState } from 'react';

interface Conversation {
  id: number;
  contact_id: number;
  contact_name: string;
  contact_email: string | null;
  contact_phone: string;
  last_message: string;
  updated_at: string;
  status: string;
  assignee_id?: number | null;
  assignee_name?: string | null;
}

interface Props {
  selectedId: number | null;
  onSelect: (conv: Conversation) => void;
  refreshKey: number;
  token: string | null;
}

const Sidebar = ({ selectedId, onSelect, refreshKey, token }: Props) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeTab, setActiveTab] = useState<'unassigned' | 'mine' | 'assigned' | 'all'>('unassigned');

  const fetchConversations = async () => {
    if (!token) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/conversations?tab=${activeTab}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setConversations(data);
      }
    } catch (err) {
      console.error('Gagal memuat sidebar:', err);
    }
  };

  useEffect(() => {
    fetchConversations();
    // Refresh sidebar setiap 10 detik agar tetap up to date
    const interval = setInterval(fetchConversations, 10000);
    return () => clearInterval(interval);
  }, [refreshKey, activeTab]);

  return (
    <div className="w-80 bg-base-100 border-r border-base-300 flex flex-col h-full shrink-0">
      <div className="p-4 border-b border-base-300 bg-base-200 flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <h2 className="font-bold text-lg italic">💬 Inbox</h2>
          <button 
            className="btn btn-xs btn-primary btn-outline"
            onClick={() => {
              const phone = window.prompt("Masukkan nomor WhatsApp tujuan (Misal: 62812345678):");
              if (phone) {
                const name = window.prompt("Masukkan nama kontak (Opsional):") || undefined;
                onStartChat(phone, name);
              }
            }}
          >
            ➕ Baru
          </button>
        </div>
        <div className="flex gap-2 mt-1 overflow-x-auto whitespace-nowrap pb-2 custom-scrollbar">
          <button 
            className={`btn btn-xs shrink-0 ${activeTab === 'unassigned' ? 'btn-active' : 'btn-ghost'}`}
            onClick={() => setActiveTab('unassigned')}
            title="Belum Ada Pemilik"
          >
            Antrean
          </button>
          <button 
            className={`btn btn-xs shrink-0 ${activeTab === 'mine' ? 'btn-active' : 'btn-ghost'}`}
            onClick={() => setActiveTab('mine')}
            title="Tiket Saya"
          >
            Tiketku
          </button>
          <button 
            className={`btn btn-xs shrink-0 ${activeTab === 'assigned' ? 'btn-active' : 'btn-ghost'}`}
            onClick={() => setActiveTab('assigned')}
            title="Sedang Ditangani"
          >
            Aktif
          </button>
          <button 
            className={`btn btn-xs shrink-0 ${activeTab === 'all' ? 'btn-active' : 'btn-ghost'}`}
            onClick={() => setActiveTab('all')}
            title="Semua Tiket"
          >
            Semua
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 && (
          <div className="p-8 text-center opacity-30 italic text-sm whitespace-normal">
            {activeTab === 'unassigned' ? 'Hore! Tidak ada antrean tiket baru.' : 
             activeTab === 'mine' ? 'Anda belum mengambil tiket apa pun.' :
             activeTab === 'assigned' ? 'Belum ada tiket yang sedang ditangani.' : 
             'Belum ada tiket sama sekali.'}
          </div>
        )}

        {conversations.map((conv) => (
          <div 
            key={conv.id} 
            onClick={() => onSelect(conv)}
            className={`flex gap-3 p-4 cursor-pointer hover:bg-base-200 transition-colors border-b border-base-200 ${
              selectedId === conv.id ? 'bg-primary/10 border-l-4 border-l-primary' : ''
            }`}
          >
            <div className="avatar placeholder">
              <div className="bg-neutral text-neutral-content rounded-full w-12 shadow-sm">
                <span>{conv.contact_name.substring(0, 2).toUpperCase()}</span>
              </div>
            </div>
            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="flex justify-between items-center">
                <span className="font-bold text-sm truncate">{conv.contact_name}</span>
                <span className="text-[10px] text-base-content/60 font-mono">
                  {conv.ticket_id ? `#TKT-${String(conv.ticket_id).padStart(4, '0')}` : 'Outbound'} • {new Date(conv.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <span className="text-xs text-base-content/70 truncate mt-1 italic">
                {conv.last_message || 'Tidak ada pesan...'}
              </span>
              <div className="flex gap-1 mt-2 flex-wrap">
                 <div className="badge badge-primary badge-outline text-[9px] h-4">WhatsApp</div>
                 {conv.status === 'open' && <div className="badge badge-success badge-xs text-white">Active</div>}
                 {conv.assignee_name && (
                   <div className="badge badge-neutral badge-outline text-[9px] h-4 truncate max-w-[80px]">
                     {conv.assignee_name}
                   </div>
                 )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Sidebar;