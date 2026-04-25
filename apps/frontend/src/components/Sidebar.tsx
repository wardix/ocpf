import React, { useEffect, useState } from 'react';

interface Conversation {
  id: number;
  contact_name: string;
  contact_phone: string;
  last_message: string;
  updated_at: string;
  status: string;
}

interface Props {
  selectedId: number | null;
  onSelect: (id: number, phone: string, name: string) => void;
  refreshKey: number;
}

const Sidebar = ({ selectedId, onSelect, refreshKey }: Props) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeTab, setActiveTab] = useState<'open' | 'resolved'>('open');

  const fetchConversations = async () => {
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/conversations?status=${activeTab}`);
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
      <div className="p-4 border-b border-base-300 bg-base-200">
        <h2 className="font-bold text-lg italic">💬 Inbox</h2>
        <div className="flex gap-2 mt-3">
          <button 
            className={`btn btn-sm flex-1 ${activeTab === 'open' ? 'btn-active' : 'btn-ghost'}`}
            onClick={() => setActiveTab('open')}
          >
            Aktif
          </button>
          <button 
            className={`btn btn-sm flex-1 ${activeTab === 'resolved' ? 'btn-active' : 'btn-ghost'}`}
            onClick={() => setActiveTab('resolved')}
          >
            Selesai
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 && (
          <div className="p-8 text-center opacity-30 italic text-sm">
            {activeTab === 'open' ? 'Menunggu chat masuk...' : 'Belum ada tiket selesai.'}
          </div>
        )}

        {conversations.map((conv) => (
          <div 
            key={conv.id} 
            onClick={() => onSelect(conv.id, conv.contact_phone, conv.contact_name)}
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
                <span className="text-[10px] text-base-content/60">
                  {new Date(conv.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <span className="text-xs text-base-content/70 truncate mt-1 italic">
                {conv.last_message || 'Tidak ada pesan...'}
              </span>
              <div className="flex gap-1 mt-2">
                 <div className="badge badge-primary badge-outline text-[9px] h-4">WhatsApp</div>
                 {conv.status === 'open' && <div className="badge badge-success badge-xs">Active</div>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Sidebar;