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

interface Props {
  messages: Message[];
  selectedConv: SelectedConversation;
  onResolve: () => void;
  onAssign: () => void;
  token: string | null;
  currentUser: any;
  hasMoreMessages?: boolean;
  isLoadingOlder?: boolean;
  onLoadMore?: () => void;
}

const ChatArea = ({ messages, selectedConv, onResolve, onAssign, token, currentUser, hasMoreMessages, isLoadingOlder, onLoadMore }: Props) => {
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [isUnassigning, setIsUnassigning] = useState(false);
  const [isPrivateNote, setIsPrivateNote] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  // State untuk Canned Responses
  const [cannedResponses, setCannedResponses] = useState<CannedResponse[]>([]);
  const [showCanned, setShowCanned] = useState(false);
  const [cannedSearch, setCannedSearch] = useState('');

  const handleCopyLink = (type: 'phone' | 'ticket', id: string | number) => {
    const url = `${window.location.origin}/?${type}=${id}`;
    navigator.clipboard.writeText(url);
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

  const handleAssign = async () => {
    if (!token) return;
    setIsAssigning(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/conversations/${selectedConv.id}/assign`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        }
      });
      if (response.ok) {
        onAssign(); // Panggil fungsi refresh sidebar di App.tsx
      } else {
        const errData = await response.json();
        alert(errData.error || 'Gagal mengambil tiket');
      }
    } catch (err) {
      console.error('Gagal mengambil tiket:', err);
    } finally {
      setIsAssigning(false);
    }
  };

  const handleUnassign = async () => {
    const confirm = window.confirm("Apakah Anda yakin ingin melepas tiket ini kembali ke antrean?");
    if (!confirm || !token) return;

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
        onResolve(); // Melepas tiket memiliki efek UI yang sama dengan resolve (menutup chat dan refresh)
      } else {
        const errData = await response.json();
        alert(errData.error || 'Gagal melepas tiket');
      }
    } catch (err) {
      console.error('Gagal melepas tiket:', err);
    } finally {
      setIsUnassigning(false);
    }
  };

  const handleResolve = async () => {
    const confirm = window.confirm("Apakah Anda yakin ingin menutup tiket obrolan ini?");
    if (!confirm || !token) return;

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
        onResolve(); // Panggil fungsi reset di App.tsx
      }
    } catch (err) {
      console.error('Gagal menutup tiket:', err);
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
          conversation_id: selectedConv.id,
          account_id: 1,
          media: mediaPayload,
          is_private: isPrivateNote
        })
      });

      if (response.ok) {
        setInputText(''); // Reset input setelah berhasil kirim
        clearFile(); // Hapus file yang dipilih
        setIsPrivateNote(false); // Reset mode ke publik
      }
    } catch (err) {
      console.error('Gagal kirim pesan:', err);
    } finally {
      setIsSending(false);
    }
  };

  const canReply = selectedConv.assignee_id === currentUser?.id;

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
              <span className="text-base-content/50 font-mono text-[9px]">• #TKT-{String(selectedConv.id).padStart(4, '0')}</span>
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
          
          {selectedConv.assignee_id === null ? (
            <button 
              className={`btn btn-sm btn-primary text-white ${isAssigning ? 'loading' : ''}`}
              onClick={handleAssign}
              disabled={isAssigning}
            >
              🙋‍♂️ Ambil Tiket
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs badge badge-ghost">
                👤 {selectedConv.assignee_id === currentUser?.id ? 'Anda' : selectedConv.assignee_name}
              </span>
              {(selectedConv.assignee_id === currentUser?.id || !selectedConv.assignee_id) && (
                <div className="flex gap-2">
                  <button 
                    className={`btn btn-sm btn-ghost ${isUnassigning ? 'loading' : ''}`}
                    onClick={handleUnassign}
                    disabled={isUnassigning || isResolving}
                  >
                    Lepas Tiket
                  </button>
                  <button 
                    className={`btn btn-sm btn-outline btn-error ${isResolving ? 'loading' : ''}`}
                    onClick={handleResolve}
                    disabled={isResolving || isUnassigning}
                  >
                    Tutup Tiket
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Ruang Pesan Dinamis */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4 flex flex-col-reverse">
        {/* Kita balik urutannya agar scroll otomatis ke bawah */}
        <div className="flex flex-col space-y-4">
          
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 opacity-20">
              <span className="text-4xl mb-2">💬</span>
              <p className="text-sm italic">Belum ada percakapan...</p>
            </div>
          )}

          {hasMoreMessages && (
            <div className="flex justify-center pb-4">
              <button 
                className={`btn btn-sm btn-outline btn-primary ${isLoadingOlder ? 'loading' : ''}`}
                onClick={onLoadMore}
                disabled={isLoadingOlder}
              >
                Muat pesan sebelumnya
              </button>
            </div>
          )}

          {messages.length > 0 && !hasMoreMessages && <div className="divider text-[10px] opacity-30 uppercase tracking-widest">Awal Percakapan</div>}

          {messages.map((msg) => {
            if (msg.sender_type === 'System') {
              const isCopied = copiedLink?.includes(`ticket=${msg.ticket_id}`);
              return (
                <div key={msg.id} className="flex justify-center my-2 relative group">
                  <div className="bg-base-300 text-base-content/70 px-4 py-1 rounded-full text-[10px] font-medium shadow-sm flex items-center gap-2">
                    <span>{msg.content} • {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <button 
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-primary hover:scale-110"
                      onClick={() => handleCopyLink('ticket', msg.ticket_id || selectedConv.id)}
                      title="Salin Tautan ke Momen Ini"
                    >
                      {isCopied ? '✅' : '🔗'}
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div key={msg.id} className={`chat ${msg.sender_type === 'Contact' ? 'chat-start' : 'chat-end'}`}>
                <div className="chat-header text-[10px] opacity-50 mb-1">
                  {msg.sender_type === 'Contact' ? selectedConv.name : 'Anda'} 
                  {msg.is_private && <span className="ml-1 text-warning font-bold">(Private Note)</span>}
                  <time className="ml-1 opacity-50">
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </time>
                </div>
                <div className={`chat-bubble text-sm shadow-sm ${
                  msg.sender_type === 'Contact' 
                    ? 'bg-white text-base-content' 
                    : msg.is_private ? 'bg-warning text-warning-content' : 'bg-primary text-primary-content'
                }`}>
                  {/* Render Media Attachments */}
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="flex flex-col gap-2 mb-2">
                      {msg.attachments.map(att => {
                        const isImage = att.file_type.startsWith('image/');
                        const isAudio = att.file_type.startsWith('audio/');
                        const fullUrl = `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}${att.file_url}`;
                        
                        if (isImage) {
                          return <img key={att.id} src={fullUrl} alt="Attachment" className="max-w-xs rounded-md shadow-sm border border-base-300/30" />;
                        } else if (isAudio) {
                          return (
                            <audio key={att.id} controls className="max-w-[200px] h-10">
                              <source src={fullUrl} type={att.file_type} />
                              Browser Anda tidak mendukung elemen audio.
                            </audio>
                          );
                        } else {
                          return (
                            <a key={att.id} href={fullUrl} target="_blank" rel="noreferrer" className="underline font-bold text-xs truncate max-w-xs block">
                              📎 Download Dokumen
                            </a>
                          );
                        }
                      })}
                    </div>
                  )}
                  {msg.content}
                </div>
                <div className="chat-footer opacity-50 text-[10px] mt-1">
                  {msg.sender_type === 'Contact' ? 'Diterima' : 'Terkirim ✓'}
                </div>
              </div>
            );
          })}

        </div>
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
                const val = e.target.value;
                setInputText(val);
                
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

    </div>
  );
};

export default ChatArea;