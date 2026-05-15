import React, { useState, useEffect, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'
import ContactInfo from './components/ContactInfo'
import Login from './components/Login'
import Settings from './components/Settings'
import Analytics from './components/Analytics'

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
  assignee_id?: number | null;
  assignee_name?: string | null;
}

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: Error | null}> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-10 text-red-500 bg-white h-screen">
          <h1 className="text-2xl font-bold mb-4">React Error 💥</h1>
          <pre className="bg-gray-100 p-4 rounded text-sm overflow-auto">
            {this.state.error?.toString()}
            {'\n'}
            {this.state.error?.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('omni_token'));
  const [user, setUser] = useState<any>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const [selectedConv, setSelectedConv] = useState<SelectedConversation | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [currentView, setCurrentView] = useState<'inbox' | 'settings'>('inbox');

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
        // Karena arsitektur baru menggunakan tiket, cocokkan dengan ticket_id (yang ada di selectedConv.id)
        if (selectedConv && newMessage.ticket_id === selectedConv.id) {
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
        <div className="tooltip tooltip-right mb-8" data-tip={`${user?.name || 'Agen'} (${user?.role || 'User'})`}>
          <div className={`avatar placeholder cursor-pointer ${wsStatus === 'open' ? 'online' : 'offline'}`}>
            <div className="bg-primary text-primary-content rounded-full w-10 border-2 border-neutral">
              <span className="text-sm font-bold">
                {user?.name ? user.name.substring(0, 2).toUpperCase() : 'AG'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-6 text-neutral-content/60 w-full px-2">
          <button 
            className={`btn btn-square w-full rounded-xl ${currentView === 'inbox' ? 'btn-active text-white bg-white/20' : 'btn-ghost hover:bg-white/10 hover:text-white'}`} 
            onClick={() => setCurrentView('inbox')}
            title="Inbox"
          >
            💬
          </button>
          {user?.role === 'administrator' && (
            <>
              <button 
                className={`btn btn-square w-full rounded-xl ${currentView === 'analytics' ? 'btn-active text-white bg-white/20' : 'btn-ghost hover:bg-white/10 hover:text-white'}`} 
                onClick={() => setCurrentView('analytics')}
                title="Laporan & Analitik"
              >
                📊
              </button>
              <button 
                className={`btn btn-square w-full rounded-xl ${currentView === 'settings' ? 'btn-active text-white bg-white/20' : 'btn-ghost hover:bg-white/10 hover:text-white'}`} 
                onClick={() => setCurrentView('settings')}
                title="Pengaturan"
              >
                ⚙️
              </button>
            </>
          )}
          <div className="flex-1"></div>
          <button className="btn btn-square btn-ghost hover:text-white w-full rounded-xl" onClick={handleLogout} title="Logout">🚪</button>
        </div>
      </div>

      {currentView === 'inbox' ? (
        <>
          <Sidebar 
            selectedId={selectedConv?.id || null} 
            onSelect={(id, phone, name, assignee_id, assignee_name) => setSelectedConv({ id, phone, name, assignee_id, assignee_name })} 
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
                onAssign={() => setRefreshKey(k => k + 1)}
                token={token}
                currentUser={user}
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
        </>
      ) : currentView === 'analytics' ? (
        <Analytics token={token} />
      ) : (
        <Settings token={token} />
      )}
    </div>
  )
}

export default function AppWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}