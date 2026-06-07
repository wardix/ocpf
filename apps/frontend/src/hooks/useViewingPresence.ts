import { useEffect, useState, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';

export interface Viewer {
  id: number;
  name: string;
}

export function useViewingPresence(conversationId: number | undefined) {
  const { token, user: currentUser } = useAuthStore();
  const { wsInstance, activeViewers } = useChatStore();
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const heartbeatInterval = useRef<number | null>(null);

  // Sync with global store activeViewers
  useEffect(() => {
    if (!currentUser || !activeViewers) return;
    const currentViewers = activeViewers[conversationId || 0] || [];
    setViewers(currentViewers.filter(v => v.id !== currentUser.id));
  }, [activeViewers, conversationId, currentUser]);

  // Initial fetch and heartbeat setup
  useEffect(() => {
    if (!conversationId || !token || !currentUser || !wsInstance) {
      setViewers([]);
      return;
    }

    let isMounted = true;

    // Fetch current viewers initially
    const fetchViewers = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
        const res = await fetch(`${apiUrl}/api/conversations/${conversationId}/viewers`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const json = await res.json();
        if (json.success && isMounted) {
          useChatStore.getState().setActiveViewers(conversationId, json.data);
        }
      } catch (err) {
        console.error('Error fetching viewers:', err);
      }
    };

    fetchViewers();

    // Start heartbeat
    const sendHeartbeat = () => {
      if (wsInstance.readyState === WebSocket.OPEN) {
        wsInstance.send(JSON.stringify({
          event: 'conversation.viewing',
          data: { conversation_id: conversationId }
        }));
      }
    };

    sendHeartbeat(); // immediate first heartbeat
    heartbeatInterval.current = window.setInterval(sendHeartbeat, 10000); // 10s

    return () => {
      isMounted = false;
      if (heartbeatInterval.current) {
        clearInterval(heartbeatInterval.current);
      }
      if (wsInstance && wsInstance.readyState === WebSocket.OPEN) {
        wsInstance.send(JSON.stringify({
          event: 'conversation.left',
          data: { conversation_id: conversationId }
        }));
      }
      // Optimistically clear our own list
      useChatStore.getState().setActiveViewers(conversationId, []);
    };
  }, [conversationId, token, currentUser, wsInstance]);

  return viewers;
}
