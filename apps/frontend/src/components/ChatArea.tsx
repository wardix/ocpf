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
import { useViewingPresence } from '../hooks/useViewingPresence';

interface Props {
  onResolve: () => void;
  onAssign: () => void;
  onLoadMore?: () => void;
}

const ChatArea = ({ onResolve, onAssign, onLoadMore }: Props) => {
  const { token, user: currentUser } = useAuthStore();
  const { messages, isLoadingOlder, isContactTyping, selectedConv, scheduledMessages, hasMoreMessages, isInitialChatLoading, wsInstance } = useChatStore();
  const { addToast } = useToastStore();

  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80, // Default estimated height
    overscan: 10,
  });

  const [inputText, setInputText] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailCc, setEmailCc] = useState('');
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

  const activeViewers = useViewingPresence(selectedConv?.id);
  const currentScheduledMsgs = selectedConv ? (scheduledMessages[selectedConv.id] || []) : [];

  // Schedule Message States
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 1);
    return d.toISOString().slice(0, 16);
  });
  const [isScheduling, setIsScheduling] = useState(false);

  // Message Template States
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [searchTemplateQuery, setSearchTemplateQuery] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<any | null>(null);
  const [templateVariables, setTemplateVariables] = useState<Record<string, string>>({});
  const [resolvedTemplateBody, setResolvedTemplateBody] = useState('');
  const [isResolvingTemplate, setIsResolvingTemplate] = useState(false);

  // AI Assistant States
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [summaryData, setSummaryData] = useState<{ summary: string; key_points: string[] } | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [showSummaryModal, setShowSummaryModal] = useState(false);

  const handleFetchSuggestions = async () => {
    if (!token || !selectedConv) return;
    setLoadingSuggestions(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/ai/suggest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ conversation_id: Number(selectedConv.id) })
      });
      const result = await response.json();
      if (response.ok && result.success) {
        setSuggestions(result.data || []);
      } else {
        addToast(result.error || 'Gagal mengambil saran balasan', 'error');
      }
    } catch (err) {
      console.error('Error fetching reply suggestions:', err);
      addToast('Gagal menghubungi server', 'error');
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const handleSelectSuggestion = (text: string) => {
    setInputText(text);
    setSuggestions([]);
  };

  const handleFetchSummary = async () => {
    if (!token || !selectedConv) return;
    setLoadingSummary(true);
    setSummaryData(null);
    setShowSummaryModal(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/ai/summarize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ conversation_id: Number(selectedConv.id) })
      });
      const result = await response.json();
      if (response.ok && result.success) {
        setSummaryData(result.data);
      } else {
        addToast(result.error || 'Gagal membuat ringkasan percakapan', 'error');
        setShowSummaryModal(false);
      }
    } catch (err) {
      console.error('Error summarizing conversation:', err);
      addToast('Gagal menghubungi server', 'error');
      setShowSummaryModal(false);
    } finally {
      setLoadingSummary(false);
    }
  };

  useEffect(() => {
    if (showTemplateModal) {
      handleFetchTemplates();
    }
  }, [showTemplateModal, searchTemplateQuery]);

  useEffect(() => {
    setSuggestions([]);
    setSummaryData(null);
    setShowSummaryModal(false);
  }, [selectedConv?.id]);

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
            inbox_id: selectedConv.inbox_id || 1,
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

  // State untuk Agents & Teams (Admin Reassign)
  const [agents, setAgents] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);

  useEffect(() => {
    if (currentUser?.role === 'administrator' && token) {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      
      // Fetch agents
      fetch(`${apiUrl}/api/users/agents`, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setAgents(data);
        })
        .catch(err => console.error('Gagal mengambil daftar agen:', err));
        
      // Fetch teams
      fetch(`${apiUrl}/api/teams`, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(res => res.json())
        .then(result => {
          if (result.success) setTeams(result.data || []);
        })
        .catch(err => console.error('Gagal mengambil daftar tim:', err));
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
          const result = await response.json();
          setCannedResponses(result.data || []);
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

  const handleAssign = async (assigneeId?: number | null, teamId?: number | null) => {
    if (!token) return;
    setIsAssigning(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const bodyPayload = JSON.stringify({ 
        ...(assigneeId !== undefined && { assignee_id: assigneeId }),
        ...(teamId !== undefined && { team_id: teamId })
      });
      const response = await fetch(`${apiUrl}/api/conversations/${selectedConv.id}/assign`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: bodyPayload
      });

      if (response.ok) {
        addToast('Tiket berhasil di-assign', 'success');
        onAssign();
      } else {
        const err = await response.json();
        addToast(err.error || 'Gagal update assignment', 'error');
      }
    } catch (e) {
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

  const handleScheduleMessage = async () => {
    if ((!inputText.trim() && !selectedFile) || !token) return;
    setIsScheduling(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/scheduled-messages`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          conversation_id: Number(selectedConv.id),
          content: inputText,
          scheduled_at: scheduleDate
        })
      });
      const result = await response.json();
      if (response.ok && result.success) {
        setInputText('');
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        setShowScheduleModal(false);
        addToast('Pesan berhasil dijadwalkan', 'success');
      } else {
        addToast(result.error || 'Gagal menjadwalkan pesan', 'error');
      }
    } catch (err) {
      console.error('Error scheduling message:', err);
      addToast('Terjadi kesalahan jaringan', 'error');
    } finally {
      setIsScheduling(false);
    }
  };

  const handleCancelSchedule = async (scheduleId: number) => {
    if (!token) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/scheduled-messages/${scheduleId}/cancel`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const result = await response.json();
      if (response.ok && result.success) {
        addToast('Jadwal pesan dibatalkan', 'success');
      } else {
        addToast(result.error || 'Gagal membatalkan jadwal', 'error');
      }
    } catch (err) {
      addToast('Terjadi kesalahan jaringan', 'error');
    }
  };

  const handleFetchTemplates = async () => {
    if (!token) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const q = searchTemplateQuery ? `?q=${encodeURIComponent(searchTemplateQuery)}` : '';
      const response = await fetch(`${apiUrl}/api/message-templates${q}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const result = await response.json();
      if (response.ok && result.success) {
        setTemplates(result.data);
      }
    } catch (err) {
      console.error('Error fetching templates', err);
    }
  };

  const handleSelectTemplate = async (template: any) => {
    setSelectedTemplate(template);
    setTemplateVariables({});
    await resolveTemplate(template, {});
  };

  const resolveTemplate = async (template: any, manualVars: Record<string, string>) => {
    if (!token || !selectedConv) return;
    setIsResolvingTemplate(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/message-templates/${template.id}/resolve`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          conversation_id: Number(selectedConv.id),
          manual_variables: manualVars
        })
      });
      const result = await response.json();
      if (response.ok && result.success) {
        setResolvedTemplateBody(result.data.resolved_body);
      }
    } catch (err) {
      console.error('Error resolving template', err);
    } finally {
      setIsResolvingTemplate(false);
    }
  };

  const handleApplyTemplate = () => {
    setInputText((prev) => prev + (prev ? '\n' : '') + resolvedTemplateBody);
    setShowTemplateModal(false);
    setSelectedTemplate(null);
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
          is_private: isPrivateNote,
          email_metadata: selectedConv.provider_type === 'email' ? {
            subject: emailSubject,
            cc_addresses: emailCc.split(',').map(s => s.trim()).filter(s => s)
          } : undefined
        })
      });

      if (response.ok) {
        setInputText(''); // Reset input setelah berhasil kirim
        setEmailSubject('');
        setEmailCc('');
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
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-sm sm:text-base">{selectedConv.name}</h2>
              {currentScheduledMsgs.length > 0 && (
                <div className="badge badge-primary badge-sm" title={`${currentScheduledMsgs.length} pesan terjadwal`}>
                  🕐 {currentScheduledMsgs.length}
                </div>
              )}
            </div>
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
            className={`btn btn-xs btn-ghost text-primary gap-1 ${loadingSummary ? 'loading' : ''}`}
            onClick={handleFetchSummary}
            title="Buat Ringkasan Percakapan AI"
            disabled={loadingSummary}
          >
            📋 Ringkasan AI
          </button>
          <button 
            className="btn btn-xs btn-ghost text-base-content/50"
            onClick={() => handleCopyLink('phone', selectedConv.phone)}
            title="Salin Tautan Percakapan Terkini"
          >
            {copiedLink?.includes('phone') ? '✅ Tersalin' : '🔗 Salin Link'}
          </button>
          
          {selectedConv.ticket_id ? (
            selectedConv.assignee_id === null && selectedConv.team_id === null ? (
              <div className="flex items-center gap-2">
                <button 
                  className={`btn btn-sm btn-primary text-white ${isAssigning ? 'loading' : ''}`}
                  onClick={() => handleAssign()}
                  disabled={isAssigning}
                >
                  🙋‍♂️ Ambil Tiket
                </button>
                {currentUser?.role === 'administrator' && (agents.length > 0 || teams.length > 0) && (
                  <div className="dropdown dropdown-end">
                    <label tabIndex={0} className="btn btn-sm btn-outline gap-1">
                      Assign ke...
                    </label>
                    <ul tabIndex={0} className="dropdown-content menu bg-base-200 rounded-box w-52 p-2 shadow-lg z-50">
                      {agents.length > 0 && <li className="menu-title"><span>Agen</span></li>}
                      {agents.map(agent => (
                        <li key={agent.id}>
                          <a onClick={() => handleAssign(agent.id, null)}>
                            <span className={`badge badge-xs ${agent.availability_status === 'online' ? 'badge-success' : agent.availability_status === 'busy' ? 'badge-error' : 'badge-ghost'}`} />
                            {agent.name}
                          </a>
                        </li>
                      ))}
                      {teams.length > 0 && <li className="menu-title"><span>Tim</span></li>}
                      {teams.map(team => (
                        <li key={`team-${team.id}`}>
                          <a onClick={() => handleAssign(null, team.id)}>
                            👥 {team.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {currentUser?.role === 'administrator' && (agents.length > 0 || teams.length > 0) ? (
                  <div className="dropdown dropdown-end">
                    <label tabIndex={0} className="btn btn-sm btn-ghost gap-1 font-normal text-xs">
                      {selectedConv.team_id && !selectedConv.assignee_id ? `👥 ${selectedConv.team_name} ▾` : `👤 ${selectedConv.assignee_id === currentUser?.id ? 'Anda' : selectedConv.assignee_name} ▾`}
                    </label>
                    <ul tabIndex={0} className="dropdown-content menu bg-base-200 rounded-box w-52 p-2 shadow-lg z-50">
                      {agents.length > 0 && <li className="menu-title"><span>Agen</span></li>}
                      {agents.map(agent => (
                        <li key={agent.id}>
                          <a onClick={() => handleAssign(agent.id, null)} className={selectedConv.assignee_id === agent.id ? 'active' : ''}>
                            <span className={`badge badge-xs ${agent.availability_status === 'online' ? 'badge-success' : agent.availability_status === 'busy' ? 'badge-error' : 'badge-ghost'}`} />
                            {agent.name}
                          </a>
                        </li>
                      ))}
                      {teams.length > 0 && <li className="menu-title"><span>Tim</span></li>}
                      {teams.map(team => (
                        <li key={`team-${team.id}`}>
                          <a onClick={() => handleAssign(null, team.id)} className={selectedConv.team_id === team.id && !selectedConv.assignee_id ? 'active' : ''}>
                            👥 {team.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <span className="text-xs badge badge-ghost">
                    {selectedConv.team_id && !selectedConv.assignee_id ? `👥 ${selectedConv.team_name}` : `👤 ${selectedConv.assignee_id === currentUser?.id ? 'Anda' : selectedConv.assignee_name}`}
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
                      <div 
                        role="button"
                        tabIndex={isResolving || isUnassigning || isSnoozing ? undefined : 0} 
                        className={`btn btn-sm btn-outline btn-warning gap-1 ${isSnoozing ? 'loading' : ''} ${isResolving || isUnassigning || isSnoozing ? 'btn-disabled' : ''}`}
                      >
                        <span className="hidden sm:inline">⏱ Snooze</span>
                        <span className="sm:hidden">⏱</span>
                      </div>
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

      {/* Collision Indicator (Real-time Agent Presence) */}
      {activeViewers.length > 0 && (
        <div className={`absolute left-0 w-full z-10 bg-info/10 backdrop-blur-sm border-b border-info/20 py-1.5 px-6 shadow-sm flex items-center justify-between text-xs text-info-content transition-all ${isContactTyping ? 'top-24' : 'top-16'}`}>
          <div className="flex items-center gap-2 font-medium">
            <span className="text-info text-base animate-pulse">👁</span>
            <span>
              {activeViewers.slice(0, 2).map(v => v.name).join(', ')}
              {activeViewers.length > 2 ? ` dan ${activeViewers.length - 2} lainnya` : ''} sedang melihat obrolan ini
            </span>
          </div>
          <div className="avatar-group -space-x-3 rtl:space-x-reverse">
            {activeViewers.slice(0, 3).map(v => (
              <div key={v.id} className="avatar placeholder border-info/30" title={v.name}>
                <div className="bg-info text-info-content w-6">
                  <span className="text-[10px]">{v.name.substring(0, 2).toUpperCase()}</span>
                </div>
              </div>
            ))}
            {activeViewers.length > 3 && (
              <div className="avatar placeholder border-info/30">
                <div className="bg-base-200 text-base-content w-6">
                  <span className="text-[10px]">+{activeViewers.length - 3}</span>
                </div>
              </div>
            )}
          </div>
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

        {/* Ghost Bubbles for Scheduled Messages */}
        {currentScheduledMsgs.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            <div className="divider text-xs text-base-content/40 my-1">Pesan Terjadwal ({currentScheduledMsgs.length})</div>
            {currentScheduledMsgs.map(msg => (
              <div key={`sched-${msg.id}`} className="chat chat-end opacity-60 hover:opacity-100 transition-opacity relative group">
                <div className="chat-header text-xs opacity-50 mb-1 flex items-center gap-1">
                  <span>Sistem (Pesan Terjadwal)</span>
                  <time className="font-semibold text-primary">{new Date(msg.scheduled_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}</time>
                </div>
                <div className="chat-bubble chat-bubble-primary text-sm whitespace-pre-wrap flex flex-col gap-1 border-dashed border-2 border-primary/50 bg-base-100 text-base-content">
                  <div className="flex justify-between items-start gap-4">
                    <span>{msg.content}</span>
                    <button 
                      className="btn btn-ghost btn-xs text-error p-0 h-4 min-h-4 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => handleCancelSchedule(msg.id)}
                      title="Batalkan Jadwal"
                    >
                      ✕
                    </button>
                  </div>
                  {msg.status === 'failed' && (
                    <span className="text-xs text-error mt-1">Gagal mengirim, akan dicoba lagi...</span>
                  )}
                </div>
              </div>
            ))}
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

        {/* Form Email Khusus */}
        {selectedConv.provider_type === 'email' && !isPrivateNote && canReply && (
          <div className="flex flex-col gap-2 mb-3 px-2">
            <input 
              type="text" 
              placeholder="Subject (Opsional)" 
              className="input input-sm input-bordered w-full"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
            />
            <input 
              type="text" 
              placeholder="CC (Pisahkan dengan koma, opsional)" 
              className="input input-sm input-bordered w-full"
              value={emailCc}
              onChange={(e) => setEmailCc(e.target.value)}
            />
          </div>
        )}

        {/* Suggested Replies Chips */}
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3 p-2 bg-base-200/60 rounded-xl border border-base-300 items-center">
            <span className="text-[10px] font-bold text-base-content/50 flex items-center gap-1 uppercase tracking-wider ml-1">
              ✨ Saran AI:
            </span>
            {suggestions.map((s, idx) => (
              <button
                key={idx}
                onClick={() => handleSelectSuggestion(s)}
                className="btn btn-xs btn-outline btn-primary normal-case font-normal max-w-xs truncate rounded-full"
                title={s}
              >
                {s}
              </button>
            ))}
            <button 
              onClick={() => setSuggestions([])} 
              className="btn btn-xs btn-ghost text-error ml-auto"
            >
              ✕ Batal
            </button>
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
          <button 
            className={`btn btn-circle btn-ghost text-primary ${loadingSuggestions ? 'loading' : ''}`}
            onClick={handleFetchSuggestions}
            title="Saran Balasan AI (Smart Reply)"
            disabled={!canReply || loadingSuggestions}
          >
            ✨
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
          <div className="flex gap-2">
            <button 
              className="btn btn-square btn-outline btn-primary h-12 w-12 border-base-300"
              onClick={() => setShowTemplateModal(true)}
              disabled={isSending || !canReply}
              title="Gunakan Template"
            >
              📄
            </button>
            <button 
              className="btn btn-square btn-outline btn-primary h-12 w-12 border-base-300"
              onClick={() => setShowScheduleModal(true)}
              disabled={isSending || isScheduling || !inputText.trim() || !canReply}
              title="Jadwalkan Pesan"
            >
              🕐
            </button>
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

      {showSummaryModal && (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-md shadow-2xl border border-base-300 rounded-2xl p-6 bg-base-100">
            <h3 className="font-bold text-lg mb-2 flex items-center gap-2">
              📋 Ringkasan Percakapan AI
            </h3>
            <p className="text-xs text-base-content/50 mb-4">
              Dibuat secara otomatis berdasarkan riwayat pesan terakhir.
            </p>

            {loadingSummary ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <span className="loading loading-spinner loading-lg text-primary"></span>
                <span className="text-xs text-base-content/60 animate-pulse">Sedang menganalisis obrolan...</span>
              </div>
            ) : summaryData ? (
              <div className="space-y-4">
                <div className="bg-base-200/50 p-4 rounded-xl border border-base-300 italic text-sm text-base-content/80">
                  "{summaryData.summary}"
                </div>

                {summaryData.key_points && summaryData.key_points.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold text-base-content/60 uppercase tracking-wider mb-2">
                      Poin Penting:
                    </h4>
                    <ul className="list-disc pl-5 text-sm space-y-1.5">
                      {summaryData.key_points.map((point, i) => (
                        <li key={i} className="text-base-content/85">{point}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-6 text-sm text-error font-semibold">
                Gagal memuat ringkasan. Silakan coba lagi.
              </div>
            )}

            <div className="modal-action mt-6">
              <button 
                className="btn btn-sm btn-outline btn-neutral" 
                onClick={() => setShowSummaryModal(false)}
              >
                Tutup
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop bg-base-300/40 backdrop-blur-sm" onClick={() => setShowSummaryModal(false)}>
            <button>close</button>
          </form>
        </dialog>
      )}

      {/* Modal Jadwal Pesan */}
      {showScheduleModal && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
              <span className="text-xl">🕐</span> Jadwalkan Pesan
            </h3>
            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Pilih Waktu (Minimal 5 menit dari sekarang)</span>
              </label>
              <input 
                type="datetime-local" 
                className="input input-bordered w-full" 
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
              />
            </div>
            <div className="flex gap-2 mb-6">
              <button className="btn btn-xs btn-outline" onClick={() => {
                const d = new Date(); d.setHours(d.getHours() + 1);
                setScheduleDate(d.toISOString().slice(0, 16));
              }}>+1 Jam</button>
              <button className="btn btn-xs btn-outline" onClick={() => {
                const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9,0,0,0);
                setScheduleDate(d.toISOString().slice(0, 16));
              }}>Besok 9 Pagi</button>
            </div>
            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setShowScheduleModal(false)}>Batal</button>
              <button className={`btn btn-primary ${isScheduling ? 'loading' : ''}`} onClick={handleScheduleMessage} disabled={isScheduling}>
                Jadwalkan
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop bg-base-300/40 backdrop-blur-sm" onClick={() => setShowScheduleModal(false)}>
            <button>close</button>
          </form>
        </div>
      )}

      {/* Modal Template Pesan */}
      {showTemplateModal && (
        <div className="modal modal-open">
          <div className="modal-box max-w-2xl">
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
              <span className="text-xl">📄</span> {selectedTemplate ? 'Isi Variabel Template' : 'Pilih Template Pesan'}
            </h3>
            
            {!selectedTemplate ? (
              <>
                <div className="form-control mb-4">
                  <input 
                    type="text" 
                    placeholder="Cari template..." 
                    className="input input-bordered w-full"
                    value={searchTemplateQuery}
                    onChange={e => setSearchTemplateQuery(e.target.value)}
                  />
                </div>
                <div className="max-h-60 overflow-y-auto flex flex-col gap-2">
                  {templates.map(tmpl => (
                    <div key={tmpl.id} className="border border-base-300 p-3 rounded-lg cursor-pointer hover:bg-base-200 transition-colors" onClick={() => handleSelectTemplate(tmpl)}>
                      <div className="font-bold text-sm">{tmpl.name}</div>
                      <div className="text-xs opacity-70 truncate">{tmpl.body}</div>
                    </div>
                  ))}
                  {templates.length === 0 && <div className="text-center py-4 text-sm opacity-50">Tidak ada template ditemukan.</div>}
                </div>
                <div className="modal-action">
                  <button className="btn btn-ghost" onClick={() => setShowTemplateModal(false)}>Tutup</button>
                </div>
              </>
            ) : (
              <>
                {selectedTemplate.variables && selectedTemplate.variables.length > 0 && (
                  <div className="mb-4 flex flex-col gap-2">
                    <div className="text-sm font-semibold mb-1">Variabel Manual:</div>
                    {selectedTemplate.variables.map((v: string) => {
                      const lower = v.toLowerCase();
                      if (lower.startsWith('contact.') || lower.startsWith('customer.')) return null; // Auto-resolved
                      return (
                        <div key={v} className="form-control w-full">
                          <label className="label py-1"><span className="label-text text-xs font-mono">{v}</span></label>
                          <input 
                            type="text" 
                            className="input input-sm input-bordered w-full"
                            value={templateVariables[v] || ''}
                            onChange={e => {
                              const newVars = { ...templateVariables, [v]: e.target.value };
                              setTemplateVariables(newVars);
                              resolveTemplate(selectedTemplate, newVars);
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
                
                <div className="text-sm font-semibold mb-1">Pratinjau:</div>
                <div className="bg-base-200 p-3 rounded-lg text-sm whitespace-pre-wrap min-h-20 mb-4 border border-base-300">
                  {isResolvingTemplate ? <span className="loading loading-dots loading-sm"></span> : resolvedTemplateBody}
                </div>

                <div className="modal-action">
                  <button className="btn btn-ghost" onClick={() => setSelectedTemplate(null)}>Kembali</button>
                  <button className="btn btn-primary" onClick={handleApplyTemplate} disabled={isResolvingTemplate}>
                    Gunakan
                  </button>
                </div>
              </>
            )}
          </div>
          <form method="dialog" className="modal-backdrop bg-base-300/40 backdrop-blur-sm" onClick={() => {
            setShowTemplateModal(false);
            setSelectedTemplate(null);
          }}>
            <button>close</button>
          </form>
        </div>
      )}
    </div>
  );
};

export default ChatArea;