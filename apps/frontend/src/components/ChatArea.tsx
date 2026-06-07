import React, { useState, useRef, useEffect } from 'react';

// ... (interface lainnya tetap)

interface Attachment {
  id: number;
  file_url: string;
  file_type: string;
}

interface CannedResponse {
  id: number;
  short_code: string;
  content: string;
}

export interface Message {
  id: number;
  content: string;
  sender_type: 'Contact' | 'User' | 'System';
  created_at: string;
  conversation_id: number;
  ticket_id?: number;
  is_private?: boolean;
  attachments?: Attachment[];
}

interface SelectedConversation {
  id: number;
  phone: string;
  name: string;
  assignee_id?: number | null;
  assignee_name?: string | null;
}

import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import { useToastStore } from '../store/toastStore';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MessageBubble } from './MessageBubble';
import { ConfirmModal } from './ConfirmModal';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';

interface Props {
  onResolve: () => void;
  onAssign: () => void;
  onLoadMore?: () => void;
}

const ChatArea = ({ onResolve, onAssign, onLoadMore }: Props) => {
  const { token, user: currentUser } = useAuthStore();
  const { messages, selectedConv, hasMoreMessages, isLoadingOlder, isInitialChatLoading, wsInstance, isContactTyping } = useChatStore();
  const { addToast } = useToastStore();

  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80, // Default estimated height
    overscan: 10,
  });

  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [isUnassigning, setIsUnassigning] = useState(false);
  const [isSnoozing, setIsSnoozing] = useState(false);
  const [showCustomSnooze, setShowCustomSnooze] = useState(false);
  const [customSnoozeDate, setCustomSnoozeDate] = useState(() => new Date().toISOString().slice(0, 16));
  const [confirmAction, setConfirmAction] = useState<{ type: 'resolve' | 'unassign' } | null>(null);
  const [isPrivateNote, setIsPrivateNote] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  const lastTypingTime = useRef<number>(0);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    
    if (wsInstance && selectedConv) {
      const now = Date.now();
      if (now - lastTypingTime.current > 2000) {
        lastTypingTime.current = now;
        wsInstance.send(JSON.stringify({
          event: 'typing.agent',
          data: {
            inbox_id: 1, // Assume default or derived
            phone: selectedConv.phone
          }
        }));
      }
    }
  };

  // State untuk Canned Responses
  const [cannedResponses, setCannedResponses] = useState<CannedResponse[]>([]);
  const [showCanned, setShowCanned] = useState(false);
  const [cannedSearch, setCannedSearch] = useState('');

  // State untuk Agents (Admin Reassign)
  const [agents, setAgents] = useState<any[]>([]);

  useEffect(() => {
    if (currentUser?.role === 'administrator' && token) {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      fetch(`${apiUrl}/api/users/agents`, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setAgents(data);
        })
        .catch(err => console.error('Gagal mengambil daftar agen:', err));
    }
  }, [currentUser?.role, token]);

  // Auto scroll ke bawah saat pesan baru tiba (hanya jika scroll sudah di bawah)
  useEffect(() => {
    if (parentRef.current && messages.length > 0 && !isLoadingOlder) {
      parentRef.current.scrollTop = parentRef.current.scrollHeight;
    }
  }, [messages.length, isLoadingOlder]);

  if (!selectedConv) return null;

  const handleCopyLink = (type: 'phone' | 'ticket', id: string | number) => {
    const url = `${window.location.origin}/?${type}=${id}`;
    
    // Gunakan modern API jika tersedia (HTTPS / Localhost)
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url);
    } else {
      // Fallback untuk HTTP biasa (IP Address non-localhost)
      const textArea = document.createElement("textarea");
      textArea.value = url;
      // Pindahkan ke luar layar agar tidak merusak UI
      textArea.style.position = "absolute";
      textArea.style.left = "-999999px";
      document.body.prepend(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
      } catch (error) {
        console.error('Gagal menyalin link:', error);
      } finally {
        textArea.remove();
      }
    }

    setCopiedLink(url);
    setTimeout(() => setCopiedLink(null), 2000);
  };

  useEffect(() => {
    const fetchCanned = async () => {
      if (!token) return;
      try {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
        const response = await fetch(`${apiUrl}/api/canned-responses`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
          const data = await response.json();
          setCannedResponses(data);
        }
      } catch (err) {
        console.error('Gagal mengambil canned responses:', err);
      }
    };
    fetchCanned();
  }, [token]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const clearFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAssign = async (assigneeId?: number) => {
    if (!token) return;
    setIsAssigning(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const bodyPayload = JSON.stringify(assigneeId ? { assignee_id: assigneeId } : {});
      const response = await fetch(`${apiUrl}/api/conversations/${selectedConv.id}/assign`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: bodyPayload
      });
      if (response.ok) {
        addToast(assigneeId ? 'Tiket berhasil dipindahkan' : 'Tiket berhasil diambil alih', 'success');
        onAssign(); 
      } else {
        const errData = await response.json();
        addToast(errData.error || 'Gagal mengubah penugasan tiket', 'error');
      }
    } catch (err) {
      console.error('Gagal mengambil tiket:', err);
      addToast('Terjadi kesalahan jaringan', 'error');
    } finally {
      setIsAssigning(false);
    }
  };

  const handleUnassign = async () => {
    if (!token) return;

    setIsUnassigning(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/conversations/${selectedConv.id}/unassign`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        }
      });
      if (response.ok) {
        addToast('Tiket berhasil dilepas ke antrean', 'info');
        onResolve(); 
      } else {
        const errData = await response.json();
        addToast(errData.error || 'Gagal melepas tiket', 'error');
      }
    } catch (err) {
      console.error('Gagal melepas tiket:', err);
      addToast('Terjadi kesalahan jaringan', 'error');
    } finally {
      setIsUnassigning(false);
    }
  };

  const snoozePresets = [
    { label: '1 Jam',      getTime: () => new Date(Date.now() + 1 * 60 * 60 * 1000) },
    { label: '3 Jam',      getTime: () => new Date(Date.now() + 3 * 60 * 60 * 1000) },
    { label: 'Besok 09:00', getTime: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    }},
    { label: 'Minggu Depan', getTime: () => {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      d.setHours(9, 0, 0, 0);
      return d;
    }},
  ];

  const handleSnooze = async (snoozedUntil: string) => {
    if (!token) return;
    setIsSnoozing(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/conversations/${selectedConv.id}/snooze`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ snoozed_until: snoozedUntil })
      });
      if (response.ok) {
        addToast('Tiket berhasil di-snooze', 'success');
        setShowCustomSnooze(false);
        onResolve(); 
      } else {
        const errData = await response.json();
        addToast(errData.error || 'Gagal snooze tiket', 'error');
      }
    } catch (err) {
      console.error('Gagal snooze tiket:', err);
      addToast('Terjadi kesalahan jaringan', 'error');
    } finally {
      setIsSnoozing(false);
    }
  };

  const handleResolve = async () => {
    if (!token) return;

    setIsResolving(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/conversations/${selectedConv.id}/status`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ status: 'resolved' })
      });
      if (response.ok) {
        addToast('Tiket berhasil ditutup', 'success');
        onResolve(); 
      } else {
        const errData = await response.json();
        addToast(errData.error || 'Gagal menutup tiket', 'error');
      }
    } catch (err) {
      console.error('Gagal menutup tiket:', err);
      addToast('Terjadi kesalahan jaringan', 'error');
    } finally {
      setIsResolving(false);
    }
  };

  const handleSendMessage = async () => {
    if ((!inputText.trim() && !selectedFile) || !token) return;
    setIsSending(true);

    try {
      let mediaPayload = undefined;
      if (selectedFile) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(selectedFile);
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = error => reject(error);
        });

        mediaPayload = {
          mimetype: selectedFile.type,
          data_base64: base64,
          filename: selectedFile.name
        };
      }

      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/messages/send`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          target_id: selectedConv.phone,
          content: inputText,
          conversation_id: Number(selectedConv.id),
          account_id: 1,
          media: mediaPayload,
          is_private: isPrivateNote
        })
      });

      if (response.ok) {
        setInputText(''); // Reset input setelah berhasil kirim
        clearFile(); // Hapus file yang dipilih
        setIsPrivateNote(false); // Reset mode ke publik
      } else {
        const errData = await response.json();
        addToast(errData.error || 'Gagal mengirim pesan', 'error');
      }
    } catch (err) {
      console.error('Gagal kirim pesan:', err);
      addToast('Terjadi kesalahan jaringan saat mengirim pesan', 'error');
    } finally {
      setIsSending(false);
    }
  };

  const canReply = !selectedConv.ticket_id || selectedConv.assignee_id === currentUser?.id;

  useKeyboardShortcuts([
    {
      key: 'Enter',
      ctrl: true,
      description: 'Kirim Pesan',
      category: 'Messaging',
      action: () => {
        if (!isSending && (inputText.trim() || selectedFile) && canReply) {
          handleSendMessage();
        }
      }
    },
    {
      key: 'n',
      ctrl: true,
      shift: true,
      description: 'Toggle Private Note',
      category: 'Messaging',
      action: () => setIsPrivateNote(prev => !prev)
    },
    {
      key: 'r',
      alt: true,
      description: 'Resolve Ticket',
      category: 'Actions',
      action: () => {
        if (selectedConv.assignee_id === currentUser?.id || currentUser?.role === 'administrator') {
          setConfirmAction({ type: 'resolve' });
        }
      }
    },
    {
      key: 'a',
      alt: true,
      description: 'Assign Ticket',
      category: 'Actions',
      action: () => {
        if (selectedConv.ticket_id && selectedConv.assignee_id === null) {
          handleAssign();
        }
      }
    }
  ]);

  return (
    <div className="flex-1 flex flex-col bg-base-200/50 h-full relative">
      
      {/* Header Obrolan Dinamis */}
      <div className="h-16 border-b border-base-300 bg-base-100 flex items-center px-6 justify-between shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-3">
          <div className="avatar placeholder">
            <div className="bg-neutral text-neutral-content rounded-full w-10">
              <span>{selectedConv.name.substring(0, 2).toUpperCase()}</span>
            </div>
          </div>
          <div>
            <h2 className="font-bold text-sm sm:text-base">{selectedConv.name}</h2>
            <p className="text-[10px] text-success font-medium flex gap-2">
              <span>Online</span>
              <span className="text-base-content/50 font-mono text-[9px]">
                • {selectedConv.ticket_id ? `#TKT-${String(selectedConv.ticket_id).padStart(4, '0')}` : 'Bebas Tiket'}
              </span>
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <button 
            className="btn btn-xs btn-ghost text-base-content/50"
            onClick={() => handleCopyLink('phone', selectedConv.phone)}
            title="Salin Tautan Percakapan Terkini"
          >
            {copiedLink?.includes('phone') ? '✅ Tersalin' : '🔗 Salin Link'}
          </button>
          
          {selectedConv.ticket_id ? (
            selectedConv.assignee_id === null ? (
              <div className="flex items-center gap-2">
                <button 
                  className={`btn btn-sm btn-primary text-white ${isAssigning ? 'loading' : ''}`}
                  onClick={() => handleAssign()}
                  disabled={isAssigning}
                >
                  🙋‍♂️ Ambil Tiket
                </button>
                {currentUser?.role === 'administrator' && agents.length > 0 && (
                  <div className="dropdown dropdown-end">
                    <label tabIndex={0} className="btn btn-sm btn-outline gap-1">
                      Assign ke...
                    </label>
                    <ul tabIndex={0} className="dropdown-content menu bg-base-200 rounded-box w-52 p-2 shadow-lg z-50">
                      {agents.map(agent => (
                        <li key={agent.id}>
                          <a onClick={() => handleAssign(agent.id)}>
                            <span className={`badge badge-xs ${agent.availability_status === 'online' ? 'badge-success' : agent.availability_status === 'busy' ? 'badge-error' : 'badge-ghost'}`} />
                            {agent.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {currentUser?.role === 'administrator' && agents.length > 0 ? (
                  <div className="dropdown dropdown-end">
                    <label tabIndex={0} className="btn btn-sm btn-ghost gap-1 font-normal text-xs">
                      👤 {selectedConv.assignee_id === currentUser?.id ? 'Anda' : selectedConv.assignee_name} ▾
                    </label>
                    <ul tabIndex={0} className="dropdown-content menu bg-base-200 rounded-box w-52 p-2 shadow-lg z-50">
                      {agents.map(agent => (
                        <li key={agent.id}>
                          <a onClick={() => handleAssign(agent.id)} className={selectedConv.assignee_id === agent.id ? 'active' : ''}>
                            <span className={`badge badge-xs ${agent.availability_status === 'online' ? 'badge-success' : agent.availability_status === 'busy' ? 'badge-error' : 'badge-ghost'}`} />
                            {agent.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <span className="text-xs badge badge-ghost">
                    👤 {selectedConv.assignee_id === currentUser?.id ? 'Anda' : selectedConv.assignee_name}
                  </span>
                )}

                {(selectedConv.assignee_id === currentUser?.id || currentUser?.role === 'administrator') && (
                  <div className="flex gap-2">
                    <button 
                      className={`btn btn-sm btn-ghost ${isUnassigning ? 'loading' : ''}`}
                      onClick={() => setConfirmAction({ type: 'unassign' })}
                      disabled={isUnassigning || isResolving || isSnoozing}
                    >
                      Lepas Tiket
                    </button>

                    <div className="dropdown dropdown-end">
                      <label tabIndex={0} className={`btn btn-sm btn-outline btn-warning gap-1 ${isSnoozing ? 'loading' : ''}`} disabled={isResolving || isUnassigning || isSnoozing}>
                        <span className="hidden sm:inline">⏱ Snooze</span>
                        <span className="sm:hidden">⏱</span>
                      </label>
                      <ul tabIndex={0} className="dropdown-content menu bg-base-200 rounded-box w-48 p-2 shadow-lg z-50 mt-1">
                        {snoozePresets.map(preset => (
                          <li key={preset.label}>
                            <a onClick={() => {
                              const active = document.activeElement as HTMLElement;
                              active?.blur(); // Tutup dropdown
                              handleSnooze(preset.getTime().toISOString());
                            }}>
                              {preset.label}
                            </a>
                          </li>
                        ))}
                        <li className="border-t border-base-300 mt-1 pt-1">
                          <a onClick={() => {
                            const active = document.activeElement as HTMLElement;
                            active?.blur();
                            setShowCustomSnooze(true);
                          }}>
                            📅 Custom...
                          </a>
                        </li>
                      </ul>
                    </div>

                    <button 
                      className={`btn btn-sm btn-outline btn-error ${isResolving ? 'loading' : ''}`}
                      onClick={() => setConfirmAction({ type: 'resolve' })}
                      disabled={isResolving || isUnassigning || isSnoozing}
                    >
                      Tutup Tiket
                    </button>
                  </div>
                )}
              </div>
            )
          ) : (
             <div className="text-xs italic opacity-50 px-2">Percakapan Outbound</div>
          )}
        </div>
      </div>

      {/* Indikator Typing */}
      {isContactTyping && (
        <div className="absolute top-16 left-0 w-full z-10 bg-base-100/80 backdrop-blur-sm border-b border-base-200 py-1 px-6 shadow-sm flex items-center gap-2 text-xs text-base-content/60 italic transition-all">
          <span className="loading loading-dots loading-xs text-primary"></span>
          <span>{selectedConv.name} sedang mengetik...</span>
        </div>
      )}

      {/* Ruang Pesan Dinamis */}
      <div ref={parentRef} className="flex-1 overflow-y-auto p-6 bg-base-200/50 flex flex-col">
        
        {isInitialChatLoading ? (
          // Skeleton Loader for Chat
          <div className="flex flex-col gap-4 w-full opacity-50 p-4 mt-auto">
            <div className="flex gap-4 items-center">
              <div className="skeleton w-10 h-10 rounded-full shrink-0"></div>
              <div className="skeleton h-16 w-1/2"></div>
            </div>
            <div className="flex gap-4 items-center flex-row-reverse">
              <div className="skeleton w-10 h-10 rounded-full shrink-0"></div>
              <div className="skeleton h-12 w-1/3"></div>
            </div>
            <div className="flex gap-4 items-center">
              <div className="skeleton w-10 h-10 rounded-full shrink-0"></div>
              <div className="skeleton h-24 w-2/3"></div>
            </div>
          </div>
        ) : messages.length === 0 ? (
          // Empty State
          <div className="flex flex-col items-center justify-center h-full opacity-40">
            <span className="text-6xl mb-4">💬</span>
            <h3 className="font-bold text-lg mb-1">Belum Ada Obrolan</h3>
            <p className="text-sm">Kirim pesan pertama untuk memulai percakapan ini.</p>
          </div>
        ) : (
          <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
            
            {hasMoreMessages && (
              <div className="flex justify-center pb-4 absolute w-full" style={{ top: '0px', zIndex: 10 }}>
                <button 
                  className={`btn btn-sm btn-outline btn-primary bg-base-100 ${isLoadingOlder ? 'loading' : ''}`}
                  onClick={onLoadMore}
                  disabled={isLoadingOlder}
                >
                  Muat pesan sebelumnya
                </button>
              </div>
            )}
            {!hasMoreMessages && <div className="divider text-[10px] opacity-30 uppercase tracking-widest absolute w-full" style={{ top: '0px' }}>Awal Percakapan</div>}

            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const msg = messages[virtualRow.index];
              return (
                <div
                  key={msg.id}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <MessageBubble 
                    msg={msg} 
                    selectedConvId={selectedConv.id} 
                    selectedConvName={selectedConv.name} 
                    copiedLink={copiedLink} 
                    handleCopyLink={handleCopyLink} 
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Area Input Pesan Bawah */}
      <div className={`p-4 border-t border-base-300 transition-colors ${isPrivateNote ? 'bg-warning/20' : 'bg-base-100'}`}>
        {/* Toggle Mode (Publik vs Private) */}
        {canReply && (
          <div className="flex gap-4 mb-3 px-2">
            <label className="cursor-pointer flex items-center gap-2">
              <input type="radio" name="replyMode" className="radio radio-primary radio-xs" checked={!isPrivateNote} onChange={() => setIsPrivateNote(false)} />
              <span className="text-xs font-semibold">Balas Pelanggan</span>
            </label>
            <label className="cursor-pointer flex items-center gap-2">
              <input type="radio" name="replyMode" className="radio radio-warning radio-xs" checked={isPrivateNote} onChange={() => setIsPrivateNote(true)} />
              <span className="text-xs font-semibold text-warning-content">Catatan Internal (Privat)</span>
            </label>
          </div>
        )}

        {selectedFile && (
          <div className="mb-2 p-2 bg-base-200 rounded-lg flex items-center justify-between border border-base-300">
            <span className="text-sm truncate max-w-xs font-medium">📎 {selectedFile.name}</span>
            <button onClick={clearFile} className="btn btn-xs btn-circle btn-ghost text-error">✕</button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input 
            type="file" 
            className="hidden" 
            ref={fileInputRef} 
            onChange={handleFileChange}
            accept="image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            disabled={!canReply}
          />
          <button 
            className="btn btn-circle btn-ghost" 
            onClick={() => fileInputRef.current?.click()}
            title="Lampirkan File"
            disabled={!canReply}
          >
            📎
          </button>
          <div className="flex-1 relative">
            {/* Canned Responses Dropdown */}
            {showCanned && canReply && !isPrivateNote && (
              <div className="absolute bottom-full mb-2 left-0 w-full max-h-48 overflow-y-auto bg-base-100 shadow-xl border border-base-300 rounded-lg z-50">
                <ul className="menu p-2 text-sm">
                  {cannedResponses
                    .filter(r => r.short_code.toLowerCase().includes(cannedSearch.toLowerCase()))
                    .map(r => (
                    <li key={r.id}>
                      <a onClick={() => {
                        setInputText(r.content);
                        setShowCanned(false);
                      }}>
                        <div className="flex flex-col">
                          <span className="font-bold text-primary">/{r.short_code}</span>
                          <span className="text-xs opacity-70 truncate">{r.content}</span>
                        </div>
                      </a>
                    </li>
                  ))}
                  {cannedResponses.filter(r => r.short_code.toLowerCase().includes(cannedSearch.toLowerCase())).length === 0 && (
                    <li className="disabled"><a className="text-xs opacity-50">Tidak ada template yang cocok</a></li>
                  )}
                </ul>
              </div>
            )}

            <textarea 
              className="textarea textarea-bordered w-full resize-none h-12 focus:outline-primary/50 text-base" 
              placeholder={
                canReply 
                  ? "Ketik balasan Anda (atau ketik '/' untuk template)..." 
                  : selectedConv.assignee_id === null
                    ? "Silakan klik 'Ambil Tiket' terlebih dahulu untuk membalas."
                    : "Tiket ini sedang ditangani oleh agen lain."
              }
              value={inputText}
              onChange={(e) => {
                handleInputChange(e);
                
                const val = e.target.value;
                // Deteksi jika karakter pertama adalah / atau ada kata yang berawalan /
                if (val === '/') {
                  setShowCanned(true);
                  setCannedSearch('');
                } else if (val.startsWith('/') && !val.includes(' ')) {
                  setShowCanned(true);
                  setCannedSearch(val.substring(1));
                } else {
                  setShowCanned(false);
                }
              }}
              onKeyDown={(e) => { 
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  // Jika sedang membuka canned response, jangan kirim pesan
                  if (!showCanned) {
                    handleSendMessage();
                  }
                }
              }}
              disabled={isSending || !canReply}
            ></textarea>
          </div>
          <button 
            className={`btn btn-primary px-8 text-white h-12 ${isSending ? 'loading' : ''}`}
            onClick={handleSendMessage}
            disabled={isSending || (!inputText.trim() && !selectedFile) || !canReply}
          >
            {isSending ? '' : 'Kirim'}
          </button>
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmAction?.type === 'resolve'}
        title="Tutup Tiket"
        message="Apakah Anda yakin ingin menutup tiket obrolan ini? Percakapan akan dipindahkan ke tab Selesai."
        confirmText="Ya, Tutup Tiket"
        variant="error"
        onConfirm={() => { handleResolve(); setConfirmAction(null); }}
        onCancel={() => setConfirmAction(null)}
      />

      <ConfirmModal
        isOpen={confirmAction?.type === 'unassign'}
        title="Lepas Tiket"
        message="Apakah Anda yakin ingin melepas tiket ini? Tiket akan kembali ke antrean dan agen lain dapat mengambilnya."
        confirmText="Ya, Lepas Tiket"
        variant="warning"
        onConfirm={() => { handleUnassign(); setConfirmAction(null); }}
        onCancel={() => setConfirmAction(null)}
      />

      {showCustomSnooze && (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-xs shadow-xl border border-base-300">
            <h3 className="font-bold text-lg mb-4 text-center">Tidur Sementara (Snooze)</h3>
            <p className="text-xs text-base-content/60 mb-2 text-center">Pilih waktu kapan tiket ini akan dibuka otomatis kembali ke antrean aktif Anda.</p>
            <input
              type="datetime-local"
              className="input input-bordered w-full font-mono text-sm"
              min={new Date().toISOString().slice(0, 16)}
              value={customSnoozeDate}
              onChange={e => setCustomSnoozeDate(e.target.value)}
            />
            <div className="modal-action">
              <button className="btn btn-sm btn-ghost" onClick={() => setShowCustomSnooze(false)}>Batal</button>
              <button 
                className="btn btn-sm btn-warning" 
                onClick={() => handleSnooze(new Date(customSnoozeDate).toISOString())}
              >
                Snooze
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop bg-base-300/40 backdrop-blur-sm" onClick={() => setShowCustomSnooze(false)}>
            <button>close</button>
          </form>
        </dialog>
      )}
    </div>
  );
};

export default ChatArea;