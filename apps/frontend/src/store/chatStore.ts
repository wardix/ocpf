import { create } from 'zustand';

export interface Message {
  id: number;
  content: string;
  sender_type: 'Contact' | 'User' | 'System';
  created_at: string;
  conversation_id: number;
  ticket_id: number;
  attachments?: any[];
}

export interface SelectedConversation {
  id: number;
  contact_id: number;
  phone: string;
  name: string;
  email: string | null;
  ticket_id?: number | null;
  status?: string | null;
  assignee_id?: number | null;
  assignee_name?: string | null;
  inbox_id?: number | null;
  provider_type?: string;
}

export interface Viewer {
  id: number;
  name: string;
}

export interface ScheduledMessage {
  id: number;
  content: string;
  scheduled_at: string;
  status: 'pending' | 'sent' | 'cancelled' | 'failed';
  created_at: string;
}

interface ChatState {
  selectedConv: SelectedConversation | null;
  messages: Message[];
  wsStatus: 'connecting' | 'open' | 'closed';
  refreshKey: number;
  hasMoreMessages: boolean;
  isLoadingOlder: boolean;
  isInitialChatLoading: boolean;
  isContactTyping: boolean;
  wsInstance: WebSocket | null;
  activeViewers: Record<number, Viewer[]>;
  scheduledMessages: Record<number, ScheduledMessage[]>;
  
  setSelectedConv: (conv: SelectedConversation | null) => void;
  setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void;
  setWsStatus: (status: 'connecting' | 'open' | 'closed') => void;
  setWsInstance: (ws: WebSocket | null) => void;
  setIsContactTyping: (isTyping: boolean) => void;
  triggerRefresh: () => void;
  setHasMoreMessages: (hasMore: boolean) => void;
  setIsLoadingOlder: (isLoading: boolean) => void;
  setIsInitialChatLoading: (isLoading: boolean) => void;
  setActiveViewers: (conversationId: number, viewers: Viewer[]) => void;
  setScheduledMessages: (conversationId: number, messages: ScheduledMessage[]) => void;
  addScheduledMessage: (conversationId: number, message: ScheduledMessage) => void;
  removeScheduledMessage: (conversationId: number, messageId: number) => void;
  clearChat: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  selectedConv: null,
  messages: [],
  wsStatus: 'connecting',
  wsInstance: null,
  isContactTyping: false,
  refreshKey: 0,
  hasMoreMessages: false,
  isLoadingOlder: false,
  isInitialChatLoading: false,
  activeViewers: {},
  scheduledMessages: {},

  setSelectedConv: (conv) => set({ selectedConv: conv }),
  setMessages: (updater) => set((state) => ({
    messages: typeof updater === 'function' ? updater(state.messages) : updater
  })),
  setWsStatus: (status) => set({ wsStatus: status }),
  setWsInstance: (ws) => set({ wsInstance: ws }),
  setIsContactTyping: (isTyping) => set({ isContactTyping: isTyping }),
  triggerRefresh: () => set((state) => ({ refreshKey: state.refreshKey + 1 })),
  setHasMoreMessages: (hasMore) => set({ hasMoreMessages: hasMore }),
  setIsLoadingOlder: (isLoading) => set({ isLoadingOlder: isLoading }),
  setIsInitialChatLoading: (isLoading) => set({ isInitialChatLoading: isLoading }),
  setActiveViewers: (conversationId, viewers) => set((state) => ({
    activeViewers: {
      ...state.activeViewers,
      [conversationId]: viewers
    }
  })),
  setScheduledMessages: (conversationId, messages) => set((state) => ({
    scheduledMessages: {
      ...state.scheduledMessages,
      [conversationId]: messages
    }
  })),
  addScheduledMessage: (conversationId, message) => set((state) => {
    const existing = state.scheduledMessages[conversationId] || [];
    return {
      scheduledMessages: {
        ...state.scheduledMessages,
        [conversationId]: [...existing, message].sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
      }
    };
  }),
  removeScheduledMessage: (conversationId, messageId) => set((state) => {
    const existing = state.scheduledMessages[conversationId] || [];
    return {
      scheduledMessages: {
        ...state.scheduledMessages,
        [conversationId]: existing.filter(m => m.id !== messageId)
      }
    };
  }),
  clearChat: () => set({ selectedConv: null, messages: [], activeViewers: {}, scheduledMessages: {} })
}));