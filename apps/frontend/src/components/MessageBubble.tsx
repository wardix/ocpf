import React, { memo } from 'react';

export interface Attachment {
  id: number;
  file_url: string;
  file_type: string;
}

export interface MessageProps {
  msg: {
    id: number;
    content: string;
    sender_type: 'Contact' | 'User' | 'System';
    created_at: string;
    ticket_id?: number;
    is_private?: boolean;
    status?: 'sent' | 'delivered' | 'read' | 'failed';
    attachments?: Attachment[];
    email_metadata?: {
      subject?: string;
      cc_addresses?: string[];
      bcc_addresses?: string[];
      html_content?: string;
      has_attachments?: boolean;
    };
  };
  selectedConvId: number;
  selectedConvName: string;
  copiedLink: string | null;
  handleCopyLink: (type: 'phone' | 'ticket', id: string | number) => void;
}

const MessageBubbleComponent = ({ msg, selectedConvId, selectedConvName, copiedLink, handleCopyLink }: MessageProps) => {
  if (msg.sender_type === 'System') {
    const isCopied = copiedLink?.includes(`ticket=${msg.ticket_id}`);
    return (
      <div className="flex justify-center my-2 relative group w-full">
        <div className="bg-base-300 text-base-content/70 px-4 py-1 rounded-full text-[10px] font-medium shadow-sm flex items-center gap-2">
          <span>{msg.content} • {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <button 
            className="opacity-0 group-hover:opacity-100 transition-opacity text-primary hover:scale-110"
            onClick={() => handleCopyLink('ticket', msg.ticket_id || selectedConvId)}
            title="Salin Tautan ke Momen Ini"
          >
            {isCopied ? '✅' : '🔗'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`chat w-full ${msg.sender_type === 'Contact' ? 'chat-start' : 'chat-end'}`}>
      <div className="chat-header text-[10px] opacity-50 mb-1">
        {msg.sender_type === 'Contact' ? selectedConvName : 'Anda'} 
        {msg.is_private && <span className="ml-1 text-warning font-bold">(Private Note)</span>}
        <time className="ml-1 opacity-50">
          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </time>
      </div>
      <div className={`chat-bubble text-sm shadow-sm whitespace-pre-wrap break-words ${
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
        
        {/* Render Email Metadata */}
        {msg.email_metadata && (
          <div className="mb-2 p-2 bg-base-100/50 rounded text-xs border border-base-300/30 text-base-content w-full max-w-full">
            {msg.email_metadata.subject && <div className="font-bold mb-1">Subject: {msg.email_metadata.subject}</div>}
            {msg.email_metadata.cc_addresses && msg.email_metadata.cc_addresses.length > 0 && (
              <div className="opacity-70 mb-1">CC: {msg.email_metadata.cc_addresses.join(', ')}</div>
            )}
            {msg.email_metadata.html_content && (
              <div className="mt-2 bg-white rounded p-1 w-full overflow-hidden">
                <iframe 
                  srcDoc={msg.email_metadata.html_content} 
                  sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
                  className="w-full border-none min-h-[200px]"
                  title="Email Content"
                />
              </div>
            )}
          </div>
        )}
        
        {msg.content}
      </div>
      <div className="chat-footer opacity-50 text-[10px] mt-1 flex items-center gap-1">
        {msg.sender_type === 'Contact' ? 'Diterima' : (
          <>
            <span>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            {msg.status === 'failed' && <span className="text-error font-bold" title="Gagal Terkirim">❌</span>}
            {msg.status === 'sent' && <span title="Terkirim">✓</span>}
            {msg.status === 'delivered' && <span title="Tersampaikan">✓✓</span>}
            {msg.status === 'read' && <span className="text-info font-bold" title="Dibaca">✓✓</span>}
          </>
        )}
      </div>
    </div>
  );
};

export const MessageBubble = memo(MessageBubbleComponent, (prev, next) => {
  return prev.msg.id === next.msg.id && prev.copiedLink === next.copiedLink && prev.msg.status === next.msg.status;
});
