import React, { useState, useRef } from 'react';

// ... (interface lainnya tetap)

interface Attachment {
  id: number;
  file_url: string;
  file_type: string;
}

interface Message {
  id: number;
  content: string;
  sender_type: 'Contact' | 'User' | 'System';
  created_at: string;
  conversation_id: number;
  attachments?: Attachment[];
}

interface SelectedConversation {
  id: number;
  phone: string;
  name: string;
}

interface Props {
  messages: Message[];
  selectedConv: SelectedConversation;
  onResolve: () => void;
}

const ChatArea = ({ messages, selectedConv, onResolve }: Props) => {
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const clearFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleResolve = async () => {
    const confirm = window.confirm("Apakah Anda yakin ingin menutup tiket obrolan ini?");
    if (!confirm) return;

    setIsResolving(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/conversations/${selectedConv.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
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
    if (!inputText.trim() && !selectedFile) return;
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_id: selectedConv.phone,
          content: inputText,
          conversation_id: selectedConv.id,
          account_id: 1,
          media: mediaPayload
        })
      });

      if (response.ok) {
        setInputText(''); // Reset input setelah berhasil kirim
        clearFile(); // Hapus file yang dipilih
      }
    } catch (err) {
      console.error('Gagal kirim pesan:', err);
    } finally {
      setIsSending(false);
    }
  };

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
            <p className="text-[10px] text-success font-medium">Online</p>
          </div>
        </div>
        
        <div className="flex gap-2">
          <button 
            className={`btn btn-sm btn-outline btn-error ${isResolving ? 'loading' : ''}`}
            onClick={handleResolve}
            disabled={isResolving}
          >
            Tutup Tiket
          </button>
          <button className="btn btn-sm btn-outline">Tunda (Snooze)</button>
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

          {messages.length > 0 && <div className="divider text-[10px] opacity-30 uppercase tracking-widest">Awal Percakapan</div>}

          {messages.map((msg) => {
            if (msg.sender_type === 'System') {
              return (
                <div key={msg.id} className="flex justify-center my-2">
                  <div className="bg-base-300 text-base-content/70 px-4 py-1 rounded-full text-[10px] font-medium shadow-sm">
                    {msg.content} • {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              );
            }

            return (
              <div key={msg.id} className={`chat ${msg.sender_type === 'Contact' ? 'chat-start' : 'chat-end'}`}>
                <div className="chat-header text-[10px] opacity-50 mb-1">
                  {msg.sender_type === 'Contact' ? selectedConv.name : 'Anda'} 
                  <time className="ml-1 opacity-50">
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </time>
                </div>
                <div className={`chat-bubble text-sm shadow-sm ${
                  msg.sender_type === 'Contact' 
                    ? 'bg-white text-base-content' 
                    : 'bg-primary text-primary-content'
                }`}>
                  {/* Render Media Attachments */}
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="flex flex-col gap-2 mb-2">
                      {msg.attachments.map(att => {
                        const isImage = att.file_type.startsWith('image/');
                        const fullUrl = `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}${att.file_url}`;
                        return isImage ? (
                          <img key={att.id} src={fullUrl} alt="Attachment" className="max-w-xs rounded-md shadow-sm border border-base-300/30" />
                        ) : (
                          <a key={att.id} href={fullUrl} target="_blank" rel="noreferrer" className="underline font-bold text-xs truncate max-w-xs block">
                            📎 Download Dokumen
                          </a>
                        )
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
      <div className="p-4 bg-base-100 border-t border-base-300">
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
          />
          <button 
            className="btn btn-circle btn-ghost" 
            onClick={() => fileInputRef.current?.click()}
            title="Lampirkan File"
          >
            📎
          </button>
          <div className="flex-1 relative">
            <textarea 
              className="textarea textarea-bordered w-full resize-none h-12 focus:outline-primary/50 text-base" 
              placeholder="Ketik balasan Anda..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => { 
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              disabled={isSending}
            ></textarea>
          </div>
          <button 
            className={`btn btn-primary px-8 text-white h-12 ${isSending ? 'loading' : ''}`}
            onClick={handleSendMessage}
            disabled={isSending || (!inputText.trim() && !selectedFile)}
          >
            {isSending ? '' : 'Kirim'}
          </button>
        </div>
      </div>

    </div>
  );
};

export default ChatArea;