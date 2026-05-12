import React, { useState, useEffect, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'
import ContactInfo from './components/ContactInfo'
import Login from './components/Login'

interface Message {
  id: number;
  content: string;
  sender_type: 'Contact' | 'User' | 'System';
  created_at: string;
  conversation_id: number;
}

interface SelectedConversation {
  id: number;
  phone: string;
  name: string;
}

function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('omni_token'));
  const [user, setUser] = useState<any>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const [selectedConv, setSelectedConv] = useState<SelectedConversation | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleLoginSuccess = (newToken: string, loggedInUser: any) => {
    localStorage.setItem('omni_token', newToken);
    setToken(newToken);
    setUser(loggedInUser);
  };

  const handleLogout = () => {
    localStorage.removeItem('omni_token');
    setToken(null);
    setUser(null);
    setSelectedConv(null);
  };

  const fetchMessages = useCallback(async (conversationId: number) => {
    if (!token) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/conversations/${conversationId}/messages`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setMessages(data);
      } else if (response.status === 401) {
        handleLogout();
      }
    } catch (err) {
      console.error('Gagal memuat pesan:', err);
    }
  }, [token]);

  useEffect(() => {
    if (selectedConv) {
      fetchMessages(selectedConv.id);
    }
  }, [selectedConv, fetchMessages]);

  useEffect(() => {
    if (!token) return;
    
    const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3000';
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => setWsStatus('open');
    ws.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.event === 'message.new') {
        const newMessage = payload.data;
        // Hanya tambahkan pesan ke state jika conversation_id cocok dengan yang sedang dibuka
        if (selectedConv && newMessage.conversation_id === selectedConv.id) {
          setMessages((prev) => [...prev, newMessage]);
        }
      }
    };
    ws.onclose = () => setWsStatus('closed');
    return () => ws.close();
  }, [selectedConv, token]);

  if (!token) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-base-200 font-sans text-base-content">
      <div className="w-16 bg-neutral flex flex-col items-center py-4 shrink-0 shadow-lg z-20">
        <div className="tooltip tooltip-right mb-8" data-tip="Status Koneksi">
           <div className={`avatar placeholder cursor-pointer`}>
            <div className={`${wsStatus === 'open' ? 'bg-success' : 'bg-error'} text-white rounded-full w-10 border-2 border-white/20`}>
              <span className="text-[10px]">{wsStatus === 'open' ? 'ON' : 'OFF'}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-6 text-neutral-content/60 w-full px-2">
          <button className="btn btn-square btn-ghost text-white bg-white/10 hover:bg-white/20 w-full rounded-xl" title="Inbox">💬</button>
          <button className="btn btn-square btn-ghost hover:text-white w-full rounded-xl" onClick={handleLogout} title="Logout">🚪</button>
        </div>
      </div>

      <Sidebar 
        selectedId={selectedConv?.id || null} 
        onSelect={(id, phone, name) => setSelectedConv({ id, phone, name })} 
        refreshKey={refreshKey}
        token={token}
      />
      
      {selectedConv ? (
        <>
          <ChatArea 
            messages={messages} 
            selectedConv={selectedConv}
            onResolve={() => {
              setSelectedConv(null);
              setRefreshKey(k => k + 1);
            }}
            token={token}
          />
          <ContactInfo selectedConv={selectedConv} />
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center bg-base-200/30 text-base-content/40">
           <span className="text-6xl mb-4">📥</span>
           <h2 className="text-xl font-bold">Pilih percakapan untuk memulai</h2>
           <p className="text-sm">Silakan pilih salah satu pesan di samping kiri.</p>
        </div>
      )}
    </div>
  )
}

export default App