import { useState, useEffect, useRef } from 'preact/hooks';

interface Message {
  id: number;
  content: string;
  sender_type: 'Contact' | 'User' | 'System';
  created_at: string;
}

interface Props {
  inboxId: number;
  apiUrl: string;
  fingerprint: string;
  sessionToken: string | null;
  onSaveSession: (token: string) => void;
}

export const Widget = ({ inboxId, apiUrl, fingerprint, sessionToken, onSaveSession }: Props) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [loading, setLoading] = useState(true);
  
  // Pre-chat Form
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submittingPrechat, setSubmittingPrechat] = useState(false);
  
  // Chat States
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isAgentTyping, setIsAgentTyping] = useState(false);
  const [activeToken, setActiveToken] = useState<string | null>(sessionToken);
  
  // Widget Customization Config
  const [config, setConfig] = useState({
    name: 'Customer Support',
    description: 'Kami siap membantu Anda',
    primaryColor: '#0284c7',
    position: 'right',
    greetingMessage: ''
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch widget config
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch(`${apiUrl}/api/widget/config?inbox_id=${inboxId}`);
        if (response.ok) {
          const res = await response.json();
          if (res.success && res.data) {
            setConfig({
              name: res.data.name,
              description: res.data.description || 'Kami siap membantu Anda',
              primaryColor: res.data.config?.theme_color || '#0284c7',
              position: res.data.config?.position || 'right',
              greetingMessage: res.data.greeting_message || ''
            });
          }
        }
      } catch (e) {
        console.error('Error fetching widget config:', e);
      }
    };
    fetchConfig();
  }, [inboxId, apiUrl]);

  // Attempt to restore session
  useEffect(() => {
    const initSession = async () => {
      setLoading(true);
      try {
        const response = await fetch(`${apiUrl}/api/widget/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inbox_id: inboxId,
            fingerprint,
            session_token: activeToken || undefined
          })
        });

        if (response.ok) {
          const res = await response.json();
          if (res.success && res.data) {
            setActiveToken(res.data.session_token);
            onSaveSession(res.data.session_token);
            setMessages(res.data.messages || []);
            setIsInitialized(true);
          }
        }
      } catch (e) {
        console.error('Error initializing widget session:', e);
      } finally {
        setLoading(false);
      }
    };
    initSession();
  }, [inboxId, apiUrl, fingerprint, activeToken, onSaveSession]);

  // WebSocket Connection Handler
  useEffect(() => {
    if (!isInitialized || !activeToken) return;

    let wsUrl = apiUrl.replace(/^http/, 'ws');
    if (wsUrl.endsWith('/')) wsUrl = wsUrl.slice(0, -1);
    
    let ws: WebSocket;
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    const connect = () => {
      ws = new WebSocket(`${wsUrl}/ws/widget?token=${activeToken}`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[Widget WS] Connected');
      };

      ws.onmessage = (event) => {
        if (event.data === 'ping') {
          ws.send('pong');
          return;
        }

        try {
          const payload = JSON.parse(event.data);
          if (payload.event === 'message.new') {
            const msg = payload.data;
            // Avoid duplicates
            setMessages(prev => {
              if (prev.some(m => m.id === msg.id)) return prev;
              return [...prev, {
                id: msg.id,
                content: msg.content,
                sender_type: msg.sender_type,
                created_at: msg.created_at
              }];
            });
            setIsAgentTyping(false);
          } else if (payload.event === 'typing.update') {
            if (payload.data.is_typing) {
              setIsAgentTyping(true);
              if (agentTypingTimeoutRef.current) clearTimeout(agentTypingTimeoutRef.current);
              agentTypingTimeoutRef.current = setTimeout(() => {
                setIsAgentTyping(false);
              }, 4000);
            } else {
              setIsAgentTyping(false);
            }
          }
        } catch (e) {
          // Ignore
        }
      };

      ws.onclose = () => {
        console.log('[Widget WS] Closed. Reconnecting...');
        reconnectTimeout = setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      clearTimeout(reconnectTimeout);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      if (agentTypingTimeoutRef.current) clearTimeout(agentTypingTimeoutRef.current);
    };
  }, [isInitialized, activeToken, apiUrl]);

  // Scroll to bottom on message updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isAgentTyping, isOpen]);

  // Pre-chat form submission
  const handleSubmitPrechat = async (e: Event) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setSubmittingPrechat(true);

    try {
      const response = await fetch(`${apiUrl}/api/widget/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inbox_id: inboxId,
          fingerprint,
          name,
          email
        })
      });

      if (response.ok) {
        const res = await response.json();
        if (res.success && res.data) {
          setActiveToken(res.data.session_token);
          onSaveSession(res.data.session_token);
          setMessages(res.data.messages || []);
          setIsInitialized(true);
        } else {
          alert('Gagal memulai chat');
        }
      }
    } catch (e) {
      console.error(e);
      alert('Koneksi gagal');
    } finally {
      setSubmittingPrechat(false);
    }
  };

  // Textarea typing changes
  const handleInputChange = (e: any) => {
    const text = e.target.value;
    setInputText(text);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        event: 'typing.widget',
        data: { is_typing: text.length > 0 }
      }));
      
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            event: 'typing.widget',
            data: { is_typing: false }
          }));
        }
      }, 2000);
    }
  };

  // Send message
  const handleSendMessage = async (e: Event) => {
    e.preventDefault();
    if (!inputText.trim() || !activeToken) return;
    const content = inputText;
    setInputText('');

    // Send typing: false
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        event: 'typing.widget',
        data: { is_typing: false }
      }));
    }

    try {
      const response = await fetch(`${apiUrl}/api/widget/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_token: activeToken,
          content
        })
      });

      if (response.ok) {
        const res = await response.json();
        if (res.success && res.data) {
          setMessages(prev => {
            if (prev.some(m => m.id === res.data.id)) return prev;
            return [...prev, {
              id: res.data.id,
              content: res.data.content,
              sender_type: 'Contact',
              created_at: res.data.created_at
            }];
          });
        }
      }
    } catch (e) {
      console.error('Failed to send message:', e);
    }
  };

  return (
    <div 
      className={`omni-widget-container ${config.position === 'left' ? 'pos-left' : ''}`}
      style={{ '--primary-color': config.primaryColor } as any}
    >
      {/* Chat Window Panel */}
      <div className={`omni-chat-card ${isOpen ? 'open' : ''}`}>
        <div className="omni-header">
          <div style={{ flex: 1 }}>
            <h3 className="omni-header-title">{config.name}</h3>
            <p className="omni-header-desc">{config.description}</p>
          </div>
          <button 
            onClick={() => setIsOpen(false)}
            style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '20px' }}
          >
            ✕
          </button>
        </div>

        <div className="omni-body">
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: '13px', color: '#6b7280' }}>
              Memuat sesi...
            </div>
          ) : !isInitialized ? (
            /* Pre-chat Form */
            <form onSubmit={handleSubmitPrechat} className="omni-prechat">
              <div>
                <h4 className="omni-prechat-title">Hubungi Kami 👋</h4>
                <p className="omni-prechat-desc">
                  Silakan masukkan nama dan email Anda untuk mulai berkonsultasi dengan tim support kami.
                </p>
              </div>
              <div className="omni-form-group">
                <label className="omni-form-label">Nama Anda</label>
                <input 
                  type="text" 
                  placeholder="Masukkan nama lengkap" 
                  className="omni-form-input"
                  value={name}
                  onInput={e => setName((e.target as HTMLInputElement).value)}
                  required
                />
              </div>
              <div className="omni-form-group">
                <label className="omni-form-label">Alamat Email</label>
                <input 
                  type="email" 
                  placeholder="nama@domain.com" 
                  className="omni-form-input"
                  value={email}
                  onInput={e => setEmail((e.target as HTMLInputElement).value)}
                  required
                />
              </div>
              <button 
                type="submit" 
                className="omni-btn"
                disabled={submittingPrechat || !name.trim() || !email.trim()}
              >
                {submittingPrechat ? 'Memulai...' : 'Mulai Obrolan'}
              </button>
            </form>
          ) : (
            /* Chat Interface */
            <>
              <div className="omni-messages-list">
                {messages.length === 0 && (
                  <div className="omni-message-bubble system">
                    Mulai obrolan baru dengan mengirimkan pesan pertama Anda. Tim kami akan segera membalas!
                  </div>
                )}
                {messages.map(msg => (
                  <div 
                    key={msg.id}
                    className={`omni-message-bubble ${
                      msg.sender_type === 'Contact' ? 'outgoing' : 
                      msg.sender_type === 'System' ? 'system' : 'incoming'
                    }`}
                  >
                    {msg.content}
                  </div>
                ))}
                
                {isAgentTyping && (
                  <div className="omni-typing-indicator" title="Agent sedang mengetik...">
                    <div className="omni-typing-dot" />
                    <div className="omni-typing-dot" />
                    <div className="omni-typing-dot" />
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Chat Input Footer */}
              <form onSubmit={handleSendMessage} className="omni-footer">
                <textarea
                  placeholder="Ketik pesan..."
                  className="omni-chat-textarea"
                  value={inputText}
                  onInput={handleInputChange}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage(e);
                    }
                  }}
                />
                <button 
                  type="submit" 
                  className="omni-send-btn"
                  disabled={!inputText.trim()}
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M2,21L23,12L2,3V10L17,12L2,14V21Z" />
                  </svg>
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      {/* Floating Toggle Button */}
      <button 
        className={`omni-bubble-btn ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle chat widget"
      >
        {isOpen ? (
          <svg viewBox="0 0 24 24">
            <path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24">
            <path d="M20,2H4A2,2 0 0,0 2,4V22L6,18H20A2,2 0 0,0 22,16V4A2,2 0 0,0 20,2M20,16H5.17L4,17.17V4H20V16Z" />
          </svg>
        )}
      </button>
    </div>
  );
};
