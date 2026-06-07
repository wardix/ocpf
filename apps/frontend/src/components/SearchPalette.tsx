import React, { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../store/authStore';

interface ContactResult {
  id: number;
  name: string;
  phone_number: string;
  conversation_id: number;
  highlight?: string;
}

interface ConversationResult {
  conversation_id: number;
  contact_name: string;
  contact_phone: string;
  last_message: string;
  ticket_status: string;
  assignee_name: string;
  updated_at: string;
}

interface MessageResult {
  message_id: number;
  conversation_id: number;
  contact_name: string;
  content: string;
  sender_type: string;
  created_at: string;
  headline: string;
}

interface SearchResult {
  contacts?: { total: number; data: ContactResult[] };
  conversations?: { total: number; data: ConversationResult[] };
  messages?: { total: number; data: MessageResult[] };
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectConversation: (conversationId: number) => void;
}

export const SearchPalette = ({ isOpen, onClose, onSelectConversation }: Props) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'contacts' | 'conversations' | 'messages'>('all');
  const inputRef = useRef<HTMLInputElement>(null);
  const { token } = useAuthStore();

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setResults(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (query.trim().length < 2) { 
      setResults(null); 
      return; 
    }

    const timer = setTimeout(async () => {
      if (!token) return;
      setIsLoading(true);
      try {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
        const res = await fetch(
          `${apiUrl}/api/search?q=${encodeURIComponent(query)}&type=${activeTab}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (res.ok) {
          const resJson = await res.json();
          setResults(resJson.data?.results || null);
        }
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setIsLoading(false);
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(timer);
  }, [query, activeTab, token]);

  if (!isOpen) return null;

  return (
    <dialog className="modal modal-open">
      <div className="modal-box max-w-2xl p-0 shadow-2xl border border-base-300">
        {/* Search Input */}
        <div className="flex items-center gap-2 p-4 border-b border-base-300">
          <span className="text-xl">🔍</span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Cari percakapan, isi pesan, atau kontak..."
            className="input input-ghost w-full focus:outline-none focus:bg-transparent text-lg"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Escape' && onClose()}
          />
          <kbd className="kbd kbd-sm opacity-50">Esc</kbd>
        </div>

        {/* Tab Filter */}
        <div className="tabs tabs-boxed m-2 bg-base-200/50">
          {['all', 'contacts', 'conversations', 'messages'].map(tab => (
            <a key={tab} className={`tab tab-sm ${activeTab === tab ? 'tab-active' : ''}`}
               onClick={() => setActiveTab(tab as any)}>
              {tab === 'all' ? 'Semua' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </a>
          ))}
        </div>

        {/* Results */}
        <div className="max-h-96 overflow-y-auto p-2 pb-4 custom-scrollbar">
          {isLoading && <div className="text-center py-8"><span className="loading loading-spinner text-primary" /></div>}

          {/* Contacts Section */}
          {results?.contacts?.data && results.contacts.data.length > 0 && (
            <div className="mb-4">
              <h4 className="text-xs font-bold text-base-content/50 px-3 mb-2 uppercase tracking-wider">
                Kontak ({results.contacts.total})
              </h4>
              {results.contacts.data.map(contact => (
                <a key={contact.id} className="flex items-center gap-3 p-3 mx-1 rounded-lg hover:bg-base-200 cursor-pointer transition-colors"
                   onClick={() => { onSelectConversation(contact.conversation_id); onClose(); }}>
                  <div className="avatar placeholder">
                    <div className="bg-neutral text-neutral-content rounded-full w-10">
                      <span>{contact.name[0]?.toUpperCase()}</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-bold" dangerouslySetInnerHTML={{ __html: contact.highlight || contact.name }} />
                    <div className="text-xs text-base-content/50 font-mono mt-0.5">{contact.phone_number}</div>
                  </div>
                </a>
              ))}
            </div>
          )}

          {/* Conversations Section */}
          {results?.conversations?.data && results.conversations.data.length > 0 && (
            <div className="mb-4">
              <h4 className="text-xs font-bold text-base-content/50 px-3 mb-2 uppercase tracking-wider">
                Percakapan ({results.conversations.total})
              </h4>
              {results.conversations.data.map(conv => (
                <a key={conv.conversation_id} className="flex flex-col gap-1 p-3 mx-1 rounded-lg hover:bg-base-200 cursor-pointer transition-colors"
                   onClick={() => { onSelectConversation(conv.conversation_id); onClose(); }}>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-bold">{conv.contact_name}</span>
                    <span className="text-[10px] text-base-content/50">{new Date(conv.updated_at).toLocaleString('id-ID')}</span>
                  </div>
                  <p className="text-xs text-base-content/70 truncate">{conv.last_message || 'Tidak ada pesan'}</p>
                </a>
              ))}
            </div>
          )}

          {/* Messages Section */}
          {results?.messages?.data && results.messages.data.length > 0 && (
            <div className="mb-4">
              <h4 className="text-xs font-bold text-base-content/50 px-3 mb-2 uppercase tracking-wider">
                Isi Pesan ({results.messages.total})
              </h4>
              {results.messages.data.map(msg => (
                <a key={msg.message_id} className="block p-3 mx-1 rounded-lg hover:bg-base-200 cursor-pointer transition-colors"
                   onClick={() => { onSelectConversation(msg.conversation_id); onClose(); }}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-bold opacity-70">{msg.contact_name}</span>
                    <span className="text-[10px] text-base-content/40">{new Date(msg.created_at).toLocaleString('id-ID')}</span>
                  </div>
                  <p className="text-sm"
                     dangerouslySetInnerHTML={{ __html: msg.headline }} />
                </a>
              ))}
            </div>
          )}

          {/* Empty State */}
          {query.length >= 2 && !isLoading && !results?.contacts?.data?.length && !results?.messages?.data?.length && !results?.conversations?.data?.length && (
            <div className="text-center py-12 opacity-50">
              <span className="text-4xl block mb-2">🤷‍♂️</span>
              <p>Tidak ditemukan hasil pencarian untuk "{query}"</p>
            </div>
          )}

          {query.length > 0 && query.length < 2 && (
             <div className="text-center py-12 opacity-50 text-sm">
                Ketik minimal 2 karakter untuk memulai pencarian...
             </div>
          )}
        </div>
      </div>
      <form method="dialog" className="modal-backdrop bg-base-300/60 backdrop-blur-sm" onClick={onClose}>
        <button type="button">close</button>
      </form>
    </dialog>
  );
};