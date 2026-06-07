import React, { useEffect, useCallback, useState } from 'react'
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'
import ContactInfo from './components/ContactInfo'
import Login from './components/Login'
import Settings from './components/Settings'
import Analytics from './components/Analytics'
import Contacts from './components/Contacts'
import Broadcast from './components/Broadcast'
import { ToastContainer } from './components/ToastContainer'

import { useAuthStore } from './store/authStore'
import { useUiStore } from './store/uiStore'
import { useChatStore } from './store/chatStore'
import { useToastStore } from './store/toastStore'
import { useThemeStore } from './store/themeStore'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { ShortcutsModal } from './components/ShortcutsModal'
import { SearchPalette } from './components/SearchPalette'

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
  const navigate = useNavigate();
  const location = useLocation();
  const { token, user, login, logout } = useAuthStore();
  const { isMuted, toggleMute } = useUiStore();
  const { theme, themes, setTheme } = useThemeStore();
  const { 
    selectedConv, messages, wsStatus, refreshKey, hasMoreMessages, isLoadingOlder, isInitialChatLoading, isContactTyping,
    setSelectedConv, setMessages, setWsStatus, triggerRefresh, setHasMoreMessages, setIsLoadingOlder, setIsInitialChatLoading, clearChat,
    setWsInstance, setIsContactTyping
  } = useChatStore();
  const { addToast } = useToastStore();

  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [myStatus, setMyStatus] = useState<'online' | 'busy' | 'offline'>('online');

  const updateAvailability = async (status: 'online' | 'busy' | 'offline') => {
    if (!token) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/users/me/availability`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ status })
      });
      if (response.ok) {
        setMyStatus(status);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (!token) return;
    const handleBeforeUnload = () => {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      // Fire-and-forget: update status ke offline saat tab ditutup
      navigator.sendBeacon(
        `${apiUrl}/api/users/me/availability`,
        new Blob([JSON.stringify({ status: 'offline' })], { type: 'application/json' })
      );
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [token]);

  useKeyboardShortcuts([
    { 
      key: '?', 
      shift: true, // Kadang ? butuh shift, tapi e.key biasanya langsung '?' 
      action: () => setShowShortcuts(true), 
      description: 'Help', 
      category: 'General' 
    },
    { 
      key: 'k', 
      ctrl: true, 
      action: () => setShowSearch(true), 
      description: 'Search', 
      category: 'Navigation' 
    },
    { 
      key: 'Escape', 
      action: () => { setShowShortcuts(false); setShowSearch(false); }, 
      description: 'Close', 
      category: 'General' 
    },
  ]);

  const playNotificationSound = useCallback(() => {
    if (isMuted) return;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.1);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch(e) {
      console.error('Audio play failed', e);
    }
  }, [isMuted]);

  const handleLogout = () => {
    logout();
    clearChat();
  };

  const fetchMessages = useCallback(async (conversationId: number, beforeId?: number) => {
    if (!token) return;
    if (beforeId) setIsLoadingOlder(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const query = beforeId ? `?before=${beforeId}` : '';
      const response = await fetch(`${apiUrl}/api/conversations/${conversationId}/messages${query}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setHasMoreMessages(data.length === 50); 
        
        if (beforeId) {
          setMessages((prev: any) => [...data, ...prev]);
        } else {
          setMessages(data);
        }
      } else if (response.status === 401) {
        addToast('Sesi Anda telah habis. Silakan login kembali.', 'error');
        handleLogout();
      } else {
        addToast('Gagal memuat pesan dari server', 'error');
      }
    } catch (err) {
      console.error('Gagal memuat pesan:', err);
      addToast('Terjadi kesalahan jaringan saat memuat pesan.', 'error');
    } finally {
      if (beforeId) setIsLoadingOlder(false);
      else setIsInitialChatLoading(false);
    }
  }, [token, setMessages, setHasMoreMessages, setIsLoadingOlder, setIsInitialChatLoading, handleLogout]);

  useEffect(() => {
    if (selectedConv) {
      fetchMessages(selectedConv.id);
    }
  }, [selectedConv?.id]); // Hentikan prop drilling effect. Cukup pantau ID-nya saja

  useEffect(() => {
    if (!token) return;
    
    let wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3000';
    if (wsUrl.endsWith('/')) wsUrl = wsUrl.slice(0, -1);
    
    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout>;
    let reconnectAttempts = 0;
    const maxDelay = 30000; 

    const connectWebSocket = () => {
      setWsStatus('connecting');
      ws = new WebSocket(`${wsUrl}/ws?token=${token}`);

      ws.onopen = () => {
        setWsStatus('open');
        setWsInstance(ws);
        if (reconnectAttempts > 0 && selectedConv) {
          fetchMessages(selectedConv.id);
        }
        reconnectAttempts = 0;
      };

      ws.onmessage = (event) => {
        if (event.data === 'ping') {
          ws?.send('pong');
          return;
        }

        try {
          const payload = JSON.parse(event.data);
          if (payload.event === 'message.new') {
            const newMessage = payload.data;
            if (newMessage.sender_type === 'Contact') {
              playNotificationSound();
            }
            if (selectedConv && newMessage.conversation_id === selectedConv.id) {
              setMessages((prev: any) => [...prev, newMessage]);
            }
          } else if (payload.event === 'message.status_changed') {
            const updatedMessage = payload.data;
            if (selectedConv && updatedMessage.conversation_id === selectedConv.id) {
              setMessages((prev: any) => prev.map((msg: any) => 
                msg.id === updatedMessage.id ? { ...msg, status: updatedMessage.status } : msg
              ));
            }
          } else if (payload.event === 'typing.update') {
            const typingData = payload.data;
            if (selectedConv && typingData.conversation_id === selectedConv.id) {
              setIsContactTyping(typingData.is_typing);
            }
          } else if (payload.event === 'agent.availability_changed') {
            window.dispatchEvent(new CustomEvent('agentStatusChanged', { detail: payload.data }));
          }
        } catch (e) {
          console.error('Invalid WS message:', event.data);
        }
      };

      ws.onclose = () => {
        setWsStatus('closed');
        setWsInstance(null);
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), maxDelay);
        reconnectTimeout = setTimeout(() => {
          reconnectAttempts++;
          connectWebSocket();
        }, delay);
      };

      ws.onerror = (error) => {
        ws?.close(); 
      };
    };

    connectWebSocket();

    return () => {
      clearTimeout(reconnectTimeout);
      if (ws) {
        ws.onclose = null; 
        ws.close();
      }
    };
  }, [selectedConv?.id, token, playNotificationSound]); 

  useEffect(() => {
    let typingTimer: ReturnType<typeof setTimeout>;
    if (isContactTyping) {
      typingTimer = setTimeout(() => {
        setIsContactTyping(false);
      }, 5000);
    }
    return () => clearTimeout(typingTimer);
  }, [isContactTyping, setIsContactTyping]);

  const startNewChat = async (phone: string, name?: string) => {
    if (!token) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/conversations/start`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ phone_number: phone, name: name })
      });
      if (response.ok) {
        const data = await response.json();
        const convId = data.id || data.data?.id;
        navigate(`/inbox/${convId}`);
        setSelectedConv({
          id: convId,
          contact_id: data.contact_id || data.data?.contact_id,
          phone: data.contact_phone || data.data?.contact_phone,
          name: data.contact_name || data.data?.contact_name,
          email: data.contact_email || data.data?.contact_email,
          ticket_id: data.ticket_id || data.data?.ticket_id,
          status: data.status || data.data?.status,
          assignee_id: data.assignee_id || data.data?.assignee_id,
          assignee_name: data.assignee_name || data.data?.assignee_name
        });
        triggerRefresh();
      } else {
        alert('Gagal memulai obrolan baru');
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (!token) return;
    
    const params = new URLSearchParams(window.location.search);
    const phone = params.get('phone');
    const ticket = params.get('ticket');

    const loadDeepLink = async () => {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      try {
        let response;
        if (phone) {
          response = await fetch(`${apiUrl}/api/conversations/by-phone/${phone}`, { headers: { 'Authorization': `Bearer ${token}` } });
        } else if (ticket) {
          response = await fetch(`${apiUrl}/api/conversations/info/${ticket}`, { headers: { 'Authorization': `Bearer ${token}` } });
        }
        
        if (response && response.ok) {
          const data = await response.json();
          const convId = data.id || data.conversation_id;
          navigate(`/inbox/${convId}`, { replace: true });
          setSelectedConv({
            id: convId,
            contact_id: data.contact_id,
            phone: data.contact_phone,
            name: data.contact_name,
            email: data.contact_email,
            ticket_id: data.ticket_id || (data.status ? data.id : null), 
            status: data.status,
            assignee_id: data.assignee_id,
            assignee_name: data.assignee_name
          });
        }
      } catch (err) {
        console.error('Gagal memuat link percakapan:', err);
      }
    };

    if (phone || ticket) {
      loadDeepLink();
    }
  }, [token]);

  if (!token) {
    return <Login onLoginSuccess={login} />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-base-200 font-sans text-base-content relative">
      <ToastContainer />
      {wsStatus !== 'open' && (
        <div className={`absolute top-0 left-0 w-full z-50 text-center py-1 text-xs font-bold shadow-md transition-all ${wsStatus === 'connecting' ? 'bg-warning text-warning-content' : 'bg-error text-white'}`}>
          {wsStatus === 'connecting' ? '⏳ Menghubungkan ke server real-time...' : '❌ Terputus dari server. Mencoba menghubungkan kembali...'}
        </div>
      )}
      <div className="w-16 bg-neutral flex flex-col items-center py-4 shrink-0 shadow-lg z-20">
        
        <div className="dropdown dropdown-right mb-8">
          <div tabIndex={0} className="tooltip tooltip-right cursor-pointer" data-tip={`${user?.name || 'Agen'} (${user?.role || 'User'}) - ${myStatus}`}>
            <div className="relative">
              <div className="avatar placeholder">
                <div className="bg-primary text-primary-content rounded-full w-10 border-2 border-neutral">
                  <span className="text-sm font-bold">
                    {user?.name ? user.name.substring(0, 2).toUpperCase() : 'AG'}
                  </span>
                </div>
              </div>
              <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-neutral ${myStatus === 'online' ? 'bg-success' : myStatus === 'busy' ? 'bg-warning' : 'bg-error'}`} />
            </div>
          </div>
          <ul tabIndex={0} className="dropdown-content menu bg-base-200 rounded-box w-32 p-2 shadow-lg z-50 ml-2">
            <li><a onClick={() => updateAvailability('online')} className={myStatus === 'online' ? 'active' : ''}><span className="w-2 h-2 rounded-full bg-success"/> Online</a></li>
            <li><a onClick={() => updateAvailability('busy')} className={myStatus === 'busy' ? 'active' : ''}><span className="w-2 h-2 rounded-full bg-warning"/> Busy</a></li>
            <li><a onClick={() => updateAvailability('offline')} className={myStatus === 'offline' ? 'active' : ''}><span className="w-2 h-2 rounded-full bg-error"/> Offline</a></li>
          </ul>
        </div>

        <div className="flex flex-col gap-6 text-neutral-content/60 w-full px-2">
          <button 
            className={`btn btn-square w-full rounded-xl ${location.pathname.startsWith('/inbox') || location.pathname === '/' ? 'btn-active text-white bg-white/20' : 'btn-ghost hover:bg-white/10 hover:text-white'}`} 
            onClick={() => navigate('/inbox')}
            title="Inbox"
          >
            💬
          </button>
          <button 
            className={`btn btn-square w-full rounded-xl ${location.pathname.startsWith('/contacts') ? 'btn-active text-white bg-white/20' : 'btn-ghost hover:bg-white/10 hover:text-white'}`} 
            onClick={() => navigate('/contacts')}
            title="Buku Telepon (Pelanggan)"
          >
            👥
          </button>
          {user?.role === 'administrator' && (
            <>
              <button 
                className={`btn btn-square w-full rounded-xl ${location.pathname.startsWith('/broadcast') ? 'btn-active text-white bg-white/20' : 'btn-ghost hover:bg-white/10 hover:text-white'}`} 
                onClick={() => navigate('/broadcast')}
                title="Pesan Massal (Broadcast)"
              >
                📢
              </button>
              <button 
                className={`btn btn-square w-full rounded-xl ${location.pathname.startsWith('/analytics') ? 'btn-active text-white bg-white/20' : 'btn-ghost hover:bg-white/10 hover:text-white'}`} 
                onClick={() => navigate('/analytics')}
                title="Laporan & Analitik"
              >
                📊
              </button>
              <button 
                className={`btn btn-square w-full rounded-xl ${location.pathname.startsWith('/settings') ? 'btn-active text-white bg-white/20' : 'btn-ghost hover:bg-white/10 hover:text-white'}`} 
                onClick={() => navigate('/settings')}
                title="Pengaturan"
              >
                ⚙️
              </button>
            </>
          )}
          <div className="flex-1"></div>
          
          <div className="dropdown dropdown-top w-full dropdown-end sm:dropdown-right">
            <label tabIndex={0} className="btn btn-square btn-ghost hover:text-white w-full rounded-xl" title="Pilih Tema">
              {theme === 'light' ? '☀️' : theme === 'dark' ? '🌙' : '🏢'}
            </label>
            <ul tabIndex={0} className="dropdown-content menu bg-base-200 rounded-box w-36 p-2 shadow-lg mb-2 z-50">
              {themes.map(t => (
                <li key={t}>
                  <a onClick={() => setTheme(t)} className={theme === t ? 'active' : ''}>
                    {t === 'light' ? '☀️' : t === 'dark' ? '🌙' : '🏢'} {t.charAt(0).toUpperCase() + t.slice(1)}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <button 
            className="btn btn-square btn-ghost hover:text-white w-full rounded-xl" 
            onClick={toggleMute} 
            title={isMuted ? "Bunyikan Notifikasi" : "Bisukan Notifikasi"}
          >
            {isMuted ? '🔕' : '🔔'}
          </button>
          <button className="btn btn-square btn-ghost hover:text-white w-full rounded-xl" onClick={handleLogout} title="Logout">🚪</button>
        </div>
      </div>

      <Routes>
        <Route path="/" element={<Navigate to="/inbox" replace />} />
        <Route path="/inbox/*" element={
          <>
            <Sidebar 
              selectedId={selectedConv?.id || null} 
              onSelect={(conv) => {
                setSelectedConv({
                  id: conv.id,
                  contact_id: conv.contact_id,
                  phone: conv.contact_phone,
                  name: conv.contact_name,
                  email: conv.contact_email,
                  ticket_id: conv.ticket_id,
                  status: conv.status,
                  assignee_id: conv.assignee_id,
                  assignee_name: conv.assignee_name
                });
                navigate(`/inbox/${conv.id}`);
              }} 
              refreshKey={refreshKey}
              onStartChat={startNewChat}
            />
            <Routes>
              <Route path=":conversationId" element={
                selectedConv ? (
                  <>
                    <ChatArea 
                      onResolve={() => {
                        setSelectedConv(null);
                        navigate('/inbox');
                        triggerRefresh();
                      }}
                      onAssign={() => triggerRefresh()}
                      onLoadMore={() => {
                        if (messages.length > 0) {
                          fetchMessages(selectedConv.id, messages[0].id);
                        }
                      }}
                    />
                    <ContactInfo 
                      selectedConv={selectedConv as any} 
                      onUpdate={(newName, newEmail) => {
                        setSelectedConv({ ...selectedConv, name: newName, email: newEmail } as any);
                        triggerRefresh();
                      }} 
                    />
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center bg-base-200/30 text-base-content/40">
                    <span className="text-6xl mb-4">⏳</span>
                    <h2 className="text-xl font-bold">Memuat percakapan...</h2>
                  </div>
                )
              } />
              <Route path="" element={
                <div className="flex-1 flex flex-col items-center justify-center bg-base-200/30 text-base-content/40">
                  <span className="text-6xl mb-4">📥</span>
                  <h2 className="text-xl font-bold">Pilih percakapan untuk memulai</h2>
                  <p className="text-sm">Silakan pilih salah satu pesan di samping kiri.</p>
                </div>
              } />
            </Routes>
          </>
        } />
        <Route path="/contacts" element={<Contacts onStartChat={startNewChat} />} />
        <Route path="/broadcast" element={<Broadcast />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>

      <ShortcutsModal isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />
      <SearchPalette 
        isOpen={showSearch} 
        onClose={() => setShowSearch(false)} 
        onSelectConversation={(convId) => {
          navigate(`/inbox/${convId}`);
          triggerRefresh();
        }}
      />
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