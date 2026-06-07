import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useAuthStore } from '../store/authStore';
import { useToastStore } from '../store/toastStore';

interface ChatbotConfig {
  id: number;
  inbox_id: number | null;
  name: string;
  config: any;
  editor_metadata: any;
  is_active: boolean;
  version: number;
  updated_at: string;
  inbox_name?: string | null;
}

export default function ChatbotBuilder() {
  const { token } = useAuthStore();
  const { addToast } = useToastStore();
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  // Config list & Selection
  const [configs, setConfigs] = useState<ChatbotConfig[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<ChatbotConfig | null>(null);
  const [inboxes, setInboxes] = useState<any[]>([]);
  const [versions, setVersions] = useState<any[]>([]);

  // Editor Panel Form
  const [botName, setBotName] = useState('');
  const [linkedInboxId, setLinkedInboxId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Modal connection state
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [pendingConnection, setPendingConnection] = useState<Connection | null>(null);
  const [transitionType, setTransitionType] = useState<'option' | 'fallback' | 'success' | 'failure'>('option');
  const [optionValue, setOptionValue] = useState('');

  // Simulator state
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [simMessages, setSimMessages] = useState<any[]>([]);
  const [simInput, setSimInput] = useState('');
  const [simBotState, setSimBotState] = useState('start');
  const [simBotActive, setSimBotActive] = useState(true);

  // Fetch configs & inboxes
  const fetchConfigs = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${apiUrl}/api/chatbot/configs`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) setConfigs(json.data);
      }
    } catch (e) {
      console.error('Error fetching chatbot configs:', e);
    }
  }, [token, apiUrl]);

  const fetchInboxes = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${apiUrl}/api/inboxes`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) setInboxes(json.data);
      }
    } catch (e) {
      console.error('Error fetching inboxes:', e);
    }
  }, [token, apiUrl]);

  const fetchVersions = useCallback(async (configId: number) => {
    if (!token) return;
    try {
      const res = await fetch(`${apiUrl}/api/chatbot/configs/${configId}/versions`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) setVersions(json.data);
      }
    } catch (e) {
      console.error('Error fetching versions:', e);
    }
  }, [token, apiUrl]);

  useEffect(() => {
    fetchConfigs();
    fetchInboxes();
  }, [fetchConfigs, fetchInboxes]);

  // Load config details
  const selectConfig = async (config: ChatbotConfig) => {
    setSelectedConfig(config);
    setBotName(config.name);
    setLinkedInboxId(config.inbox_id);
    fetchVersions(config.id);

    // Populate React Flow
    const metadata = config.editor_metadata || {};
    setNodes(metadata.nodes || []);
    setEdges(metadata.edges || []);
    setSelectedNodeId(null);
    resetSimulator();
  };

  // Create new configuration
  const handleCreateNew = async () => {
    if (!token) return;
    const name = prompt('Masukkan nama Chatbot baru:', 'Bot Baru');
    if (!name) return;

    const defaultConfig = {
      global_commands: { '!menu': 'start' },
      states: {
        start: {
          steps: [{ type: 'text', content: 'Halo! Ada yang bisa kami bantu?' }],
          options: {},
          fallback: 'start'
        }
      }
    };

    const defaultMetadata = {
      nodes: [
        {
          id: 'start',
          type: 'default',
          position: { x: 250, y: 150 },
          data: {
            label: 'Start (Mulai)',
            stateId: 'start',
            steps: [{ type: 'text', content: 'Halo! Ada yang bisa kami bantu?' }],
            action: null,
            fallback: 'start'
          }
        }
      ],
      edges: []
    };

    try {
      const res = await fetch(`${apiUrl}/api/chatbot/configs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name,
          inbox_id: null,
          config: defaultConfig,
          editor_metadata: defaultMetadata
        })
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          addToast('Chatbot berhasil dibuat', 'success');
          await fetchConfigs();
          selectConfig(json.data);
        }
      }
    } catch (e) {
      addToast('Gagal membuat chatbot baru', 'error');
    }
  };

  // Compile nodes and edges to standard json rules format
  const compileRules = () => {
    const global_commands: Record<string, string> = {};
    const states: Record<string, any> = {};

    // Base start node commands
    global_commands['!menu'] = 'start';
    global_commands['menu'] = 'start';

    nodes.forEach((node: any) => {
      const stateId = node.data.stateId || node.id;
      const steps = node.data.steps || [];
      const action = node.data.action || null;
      
      const stateObj: any = { steps };
      if (action) {
        stateObj.action = action;
      }

      // Find connections from this node
      const outgoingEdges = edges.filter(e => e.source === node.id);
      const options: Record<string, string> = {};
      let fallback: string | null = null;

      outgoingEdges.forEach(edge => {
        const targetNode = nodes.find(n => n.id === edge.target);
        if (!targetNode) return;
        const targetStateId = targetNode.data.stateId || targetNode.id;

        const label = edge.data?.label || '';
        if (label === 'fallback') {
          fallback = targetStateId;
        } else if (label === 'API Success') {
          // Put on success transition inside the api step
          const apiStep = steps.find((s: any) => s.type === 'api_call');
          if (apiStep) {
            apiStep.on_success = { target_state: targetStateId };
          }
        } else if (label === 'API Failure') {
          const apiStep = steps.find((s: any) => s.type === 'api_call');
          if (apiStep) {
            apiStep.on_failure = { target_state: targetStateId };
          }
        } else {
          // It's an option choice (e.g. "1", "2")
          options[label] = targetStateId;
        }
      });

      if (Object.keys(options).length > 0) {
        stateObj.options = options;
      }
      if (fallback) {
        stateObj.fallback = fallback;
      }

      states[stateId] = stateObj;
    });

    return { global_commands, states };
  };

  // Save current Flow
  const handleSave = async () => {
    if (!selectedConfig || !token) return;
    setSaving(true);

    const compiledConfig = compileRules();
    const metadata = { nodes, edges };

    try {
      const res = await fetch(`${apiUrl}/api/chatbot/configs/${selectedConfig.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: botName,
          inbox_id: linkedInboxId,
          config: compiledConfig,
          editor_metadata: metadata
        })
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          addToast('Alur chatbot berhasil disimpan & versi baru dibuat!', 'success');
          setSelectedConfig(json.data);
          fetchConfigs();
          fetchVersions(json.data.id);
        }
      }
    } catch (e) {
      addToast('Gagal menyimpan chatbot', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Delete config
  const handleDelete = async () => {
    if (!selectedConfig || !token) return;
    if (!confirm('Apakah Anda yakin ingin menghapus chatbot ini?')) return;

    try {
      const res = await fetch(`${apiUrl}/api/chatbot/configs/${selectedConfig.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        addToast('Chatbot berhasil dihapus', 'success');
        setSelectedConfig(null);
        fetchConfigs();
      }
    } catch (e) {
      addToast('Gagal menghapus chatbot', 'error');
    }
  };

  // Toggle Activation
  const handleToggleActive = async (activeStatus: boolean) => {
    if (!selectedConfig || !token) return;

    try {
      const res = await fetch(`${apiUrl}/api/chatbot/configs/${selectedConfig.id}/activate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ is_active: activeStatus })
      });

      if (res.ok) {
        addToast(activeStatus ? 'Chatbot aktif!' : 'Chatbot dinonaktifkan', 'success');
        fetchConfigs();
        setSelectedConfig(prev => prev ? { ...prev, is_active: activeStatus } : null);
      }
    } catch (e) {
      addToast('Gagal mengubah status aktif', 'error');
    }
  };

  // Import JSON file
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const jsonContent = JSON.parse(event.target?.result as string);
        const name = file.name.replace('_chatbot.json', '').replace('.json', '');

        const res = await fetch(`${apiUrl}/api/chatbot/configs/import`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            name: `${name} (Imported)`,
            inbox_id: null,
            chatbot_json: jsonContent
          })
        });

        if (res.ok) {
          const json = await res.json();
          if (json.success) {
            addToast('Import chatbot berhasil!', 'success');
            fetchConfigs();
            selectConfig(json.data);
          }
        }
      } catch (err) {
        addToast('Format file JSON tidak valid', 'error');
      }
    };
    reader.readAsText(file);
  };

  // Export JSON file
  const handleExport = () => {
    if (!selectedConfig) return;
    window.open(`${apiUrl}/api/chatbot/configs/${selectedConfig.id}/export?token=${token}`, '_blank');
  };

  // Rollback version
  const handleRollback = async (version: number) => {
    if (!selectedConfig || !token) return;
    if (!confirm(`Apakah Anda yakin ingin rollback ke versi ${version}?`)) return;

    try {
      const res = await fetch(`${apiUrl}/api/chatbot/configs/${selectedConfig.id}/rollback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ version })
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          addToast(`Rollback sukses ke versi ${version}`, 'success');
          selectConfig(json.data);
        }
      }
    } catch (e) {
      addToast('Gagal melakukan rollback', 'error');
    }
  };

  // Add Node to Canvas
  const addNode = () => {
    const id = `node_${Date.now()}`;
    const newNode = {
      id,
      type: 'default',
      position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 },
      data: {
        label: 'Node Respon Baru',
        stateId: id,
        steps: [{ type: 'text', content: 'Silakan ganti teks pesan ini.' }],
        action: null,
        fallback: null
      }
    };
    setNodes(prev => [...prev, newNode]);
  };

  // React Flow Connect Nodes Handler
  const onConnect = useCallback((params: Connection) => {
    setPendingConnection(params);
    setTransitionType('option');
    setOptionValue('');
    setShowConnectModal(true);
  }, []);

  const confirmConnection = () => {
    if (!pendingConnection || !pendingConnection.source || !pendingConnection.target) return;
    let label = '';
    if (transitionType === 'fallback') label = 'fallback';
    else if (transitionType === 'success') label = 'API Success';
    else if (transitionType === 'failure') label = 'API Failure';
    else label = optionValue.trim() || '*';

    const edgeData: Edge = {
      ...pendingConnection,
      source: pendingConnection.source,
      target: pendingConnection.target,
      id: `edge_${Date.now()}`,
      animated: true,
      label,
      style: { stroke: '#0284c7', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#0284c7' },
      data: { label }
    } as Edge;

    setEdges(prev => addEdge(edgeData, prev));
    setShowConnectModal(false);
    setPendingConnection(null);
  };

  // Get currently selected node object
  const activeNode = nodes.find(n => n.id === selectedNodeId);

  // Update properties on selected node
  const updateNodeData = (field: string, value: any) => {
    if (!selectedNodeId) return;
    setNodes(prev =>
      prev.map(node => {
        if (node.id === selectedNodeId) {
          const updatedData = { ...node.data, [field]: value };
          if (field === 'stateId') {
            return { ...node, id: value, data: updatedData }; // Node ID aligns with state ID
          }
          if (field === 'label') {
            return { ...node, data: updatedData };
          }
          return { ...node, data: updatedData };
        }
        return node;
      })
    );

    // If ID changed, update edges
    if (field === 'stateId' && activeNode) {
      setEdges(prev =>
        prev.map(edge => {
          let updated = { ...edge };
          if (edge.source === activeNode.id) updated.source = value;
          if (edge.target === activeNode.id) updated.target = value;
          return updated;
        })
      );
    }
  };

  // Add a step inside node
  const addStep = (type: 'text' | 'api_call') => {
    if (!activeNode) return;
    const currentSteps = activeNode.data.steps || [];
    const newStep = type === 'text'
      ? { type: 'text', content: 'Respon teks baru...' }
      : { type: 'api_call', url: 'https://api.domain.com/endpoint', method: 'GET', store_response_as: 'res_var' };
    
    updateNodeData('steps', [...currentSteps, newStep]);
  };

  const updateStep = (idx: number, stepField: string, value: any) => {
    if (!activeNode) return;
    const steps = [...(activeNode.data.steps || [])];
    steps[idx] = { ...steps[idx], [stepField]: value };
    updateNodeData('steps', steps);
  };

  const deleteStep = (idx: number) => {
    if (!activeNode) return;
    const steps = [...(activeNode.data.steps || [])].filter((_, i) => i !== idx);
    updateNodeData('steps', steps);
  };

  // PREVIEW SIMULATOR ENGINE (Local execution)
  const resetSimulator = () => {
    setSimMessages([{ id: 1, sender_type: 'System', content: '🤖 Simulator Chatbot Siap. Ketik pesan Anda untuk mencoba alur.' }]);
    setSimBotState('start');
    setSimBotActive(true);
  };

  const handleSimSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!simInput.trim()) return;

    const userInput = simInput.trim();
    setSimInput('');

    // Add user message
    const userMsg = { id: Date.now(), sender_type: 'Contact', content: userInput };
    setSimMessages(prev => [...prev, userMsg]);

    if (!simBotActive) {
      setTimeout(() => {
        setSimMessages(prev => [...prev, {
          id: Date.now() + 1,
          sender_type: 'System',
          content: '⚠️ Chatbot sedang tidak aktif (dialihkan ke CS). Kirim reset simulator untuk mengaktifkan kembali.'
        }]);
      }, 500);
      return;
    }

    // Evaluate transition
    setTimeout(async () => {
      const compiled = compileRules();
      let nextState = null;

      // Check global command
      if (compiled.global_commands && compiled.global_commands[userInput.toLowerCase()]) {
        nextState = compiled.global_commands[userInput.toLowerCase()];
      } else {
        const currentState = compiled.states[simBotState];
        if (currentState) {
          if (currentState.options) {
            if (currentState.options[userInput]) {
              nextState = currentState.options[userInput];
            } else if (currentState.options['*']) {
              nextState = currentState.options['*'];
            } else if (currentState.fallback) {
              nextState = currentState.fallback;
            }
          } else if (currentState.fallback) {
            nextState = currentState.fallback;
          }
        }
      }

      if (!nextState) {
        setSimMessages(prev => [...prev, {
          id: Date.now() + 2,
          sender_type: 'System',
          content: '🤖 Bot tidak merespon (State tidak ditemukan / fallback kosong).'
        }]);
        return;
      }

      setSimBotState(nextState);
      const targetNodeRules = compiled.states[nextState];
      if (!targetNodeRules) {
        setSimMessages(prev => [...prev, {
          id: Date.now() + 3,
          sender_type: 'System',
          content: `🤖 Transisi ke state [${nextState}] tapi isi state tidak terdefinisi.`
        }]);
        return;
      }

      // Execute steps
      const newMsgs: any[] = [];
      let active = true;

      if (targetNodeRules.steps) {
        for (const step of targetNodeRules.steps) {
          if (step.type === 'text') {
            let parsedText = step.content || '';
            parsedText = parsedText.replace(/{{user_input}}/g, userInput);
            newMsgs.push({ id: Math.random(), sender_type: 'User', content: parsedText });
          } else if (step.type === 'api_call') {
            newMsgs.push({ id: Math.random(), sender_type: 'System', content: `⚙️ [Simulasi API Call]: ${step.method || 'GET'} ${step.url}` });
          }
        }
      }

      if (targetNodeRules.action === 'assign_agent') {
        active = false;
        newMsgs.push({ id: Math.random(), sender_type: 'System', content: '👨‍💻 Chat dialihkan ke Agen (bot dinonaktifkan).' });
      }

      setSimBotActive(active);
      setSimMessages(prev => [...prev, ...newMsgs]);
    }, 600);
  };

  return (
    <div className="flex h-screen bg-base-300 overflow-hidden font-sans">
      {/* 1. Left panel: Config list */}
      <div className="w-80 bg-base-200 border-r border-base-300 flex flex-col p-4 gap-4 h-full overflow-y-auto">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold">Flow Chatbot 🤖</h2>
          <button className="btn btn-xs btn-primary" onClick={handleCreateNew}>+ Baru</button>
        </div>

        <div className="flex flex-col gap-2">
          {configs.map(cfg => (
            <div
              key={cfg.id}
              onClick={() => selectConfig(cfg)}
              className={`p-3 rounded-lg cursor-pointer border hover:border-primary transition ${
                selectedConfig?.id === cfg.id ? 'bg-primary/10 border-primary' : 'bg-base-100 border-base-300'
              }`}
            >
              <div className="flex justify-between items-center mb-1">
                <span className="font-semibold text-sm truncate max-w-[140px]">{cfg.name}</span>
                <span className={`badge badge-xs ${cfg.is_active ? 'badge-success text-white' : 'badge-ghost opacity-60'}`}>
                  {cfg.is_active ? 'Aktif' : 'Draft'}
                </span>
              </div>
              <div className="text-[11px] opacity-50 flex flex-col gap-0.5">
                <span>Inbox: {cfg.inbox_name || 'Tidak ditautkan'}</span>
                <span>Versi: {cfg.version}</span>
              </div>
            </div>
          ))}
        </div>

        {selectedConfig && (
          <div className="divider text-xs opacity-50">Pengaturan Bot</div>
        )}

        {selectedConfig && (
          <div className="flex flex-col gap-3">
            <div className="form-control w-full">
              <label className="label py-1"><span className="label-text text-xs">Nama Bot</span></label>
              <input
                type="text"
                className="input input-sm input-bordered w-full"
                value={botName}
                onChange={e => setBotName(e.target.value)}
              />
            </div>

            <div className="form-control w-full">
              <label className="label py-1"><span className="label-text text-xs">Tautkan ke Inbox</span></label>
              <select
                className="select select-sm select-bordered w-full"
                value={linkedInboxId || ''}
                onChange={e => setLinkedInboxId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">-- Pilih Inbox --</option>
                {inboxes.map(ib => (
                  <option key={ib.id} value={ib.id}>{ib.name}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 mt-2">
              <input
                type="checkbox"
                className="toggle toggle-success toggle-sm"
                checked={selectedConfig.is_active}
                onChange={e => handleToggleActive(e.target.checked)}
              />
              <span className="text-xs font-semibold">Aktifkan Chatbot</span>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-2">
              <button className="btn btn-xs btn-outline" onClick={handleExport}>Ekspor JSON</button>
              <label className="btn btn-xs btn-outline cursor-pointer text-center flex items-center justify-center">
                Impor JSON
                <input type="file" accept=".json" className="hidden" onChange={handleImport} />
              </label>
            </div>

            <button className="btn btn-xs btn-error btn-outline mt-2" onClick={handleDelete}>Hapus Bot</button>

            <div className="divider text-xs opacity-50">Riwayat Versi</div>
            <div className="flex flex-col gap-1 max-h-36 overflow-y-auto bg-base-300 p-2 rounded-lg">
              {versions.map(v => (
                <div key={v.id} className="flex justify-between items-center text-xs py-1 border-b border-base-200 last:border-none">
                  <span>Versi {v.version}</span>
                  <button
                    className="btn btn-ghost btn-xs text-[10px] text-primary"
                    onClick={() => handleRollback(v.version)}
                    disabled={v.version === selectedConfig.version}
                  >
                    {v.version === selectedConfig.version ? 'Aktif' : 'Rollback'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 2. Middle: React Flow Canvas */}
      <div className="flex-1 h-full relative flex flex-col bg-base-100">
        {selectedConfig ? (
          <>
            <div className="absolute top-4 left-4 z-10 flex gap-2">
              <button className="btn btn-sm btn-primary shadow-lg" onClick={addNode}>+ Tambah Respon (Node)</button>
              <button className="btn btn-sm btn-success text-white shadow-lg" onClick={handleSave} disabled={saving}>
                {saving ? 'Menyimpan...' : 'Simpan Alur'}
              </button>
              <button className="btn btn-sm btn-outline shadow-lg" onClick={() => setSimulatorOpen(true)}>⚙️ Tes Bot (Simulator)</button>
            </div>

            <div className="w-full h-full">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                fitView
              >
                <Controls />
                <MiniMap style={{ height: 100 }} zoomable pannable />
                <Background color="#ccc" gap={16} />
              </ReactFlow>
            </div>
          </>
        ) : (
          <div className="flex flex-col justify-center items-center h-full opacity-55">
            <span className="text-5xl mb-3">🤖</span>
            <p className="text-sm">Pilih atau buat alur chatbot baru di panel kiri.</p>
          </div>
        )}
      </div>

      {/* 3. Right side: Node Inspector */}
      {selectedConfig && activeNode && (
        <div className="w-96 bg-base-200 border-l border-base-300 flex flex-col p-4 gap-4 h-full overflow-y-auto">
          <div className="flex justify-between items-center border-b border-base-300 pb-2">
            <h3 className="font-bold text-sm">Properti Node</h3>
            <button className="btn btn-xs btn-ghost text-error" onClick={() => {
              setNodes(prev => prev.filter(n => n.id !== selectedNodeId));
              setEdges(prev => prev.filter(e => e.source !== selectedNodeId && e.target !== selectedNodeId));
              setSelectedNodeId(null);
            }}>Hapus</button>
          </div>

          <div className="form-control w-full">
            <label className="label py-1"><span className="label-text text-xs">ID State (Unik)</span></label>
            <input
              type="text"
              className="input input-sm input-bordered w-full font-mono text-xs"
              value={activeNode.data.stateId || ''}
              onChange={e => updateNodeData('stateId', e.target.value)}
            />
          </div>

          <div className="form-control w-full">
            <label className="label py-1"><span className="label-text text-xs">Label Visual</span></label>
            <input
              type="text"
              className="input input-sm input-bordered w-full text-xs"
              value={activeNode.data.label || ''}
              onChange={e => updateNodeData('label', e.target.value)}
            />
          </div>

          <div className="form-control w-full">
            <label className="label py-1"><span className="label-text text-xs">Aksi Setelah Node Ini</span></label>
            <select
              className="select select-sm select-bordered w-full text-xs"
              value={activeNode.data.action || ''}
              onChange={e => updateNodeData('action', e.target.value || null)}
            >
              <option value="">Lanjutkan Bot (Menerima input pilihan)</option>
              <option value="assign_agent">Alihkan ke CS (Matikan bot)</option>
            </select>
          </div>

          <div className="divider text-xs opacity-50 my-1">Langkah Respon (Steps)</div>
          <div className="flex gap-2">
            <button className="btn btn-xs btn-outline flex-1" onClick={() => addStep('text')}>+ Teks</button>
            <button className="btn btn-xs btn-outline flex-1" onClick={() => addStep('api_call')}>+ API Call</button>
          </div>

          <div className="flex flex-col gap-3 mt-2">
            {(activeNode.data.steps || []).map((step: any, idx: number) => (
              <div key={idx} className="bg-base-100 p-3 rounded-lg border border-base-300 relative">
                <button
                  className="btn btn-circle btn-ghost btn-xs text-error absolute top-1 right-1"
                  onClick={() => deleteStep(idx)}
                >
                  ✕
                </button>
                <span className="badge badge-sm badge-outline font-semibold mb-2">{step.type.toUpperCase()}</span>

                {step.type === 'text' ? (
                  <textarea
                    className="textarea textarea-bordered textarea-xs w-full h-20 text-xs"
                    value={step.content}
                    onChange={e => updateStep(idx, 'content', e.target.value)}
                    placeholder="Tulis pesan chatbot... (Gunakan {{contact_name}}, {{user_input}} untuk interpolasi)"
                  />
                ) : (
                  <div className="flex flex-col gap-2 text-xs">
                    <div className="grid grid-cols-3 gap-1">
                      <select
                        className="select select-bordered select-xs col-span-1"
                        value={step.method || 'GET'}
                        onChange={e => updateStep(idx, 'method', e.target.value)}
                      >
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                      </select>
                      <input
                        type="text"
                        placeholder="Variable simpan"
                        className="input input-bordered input-xs col-span-2 font-mono text-[10px]"
                        value={step.store_response_as || ''}
                        onChange={e => updateStep(idx, 'store_response_as', e.target.value)}
                      />
                    </div>
                    <input
                      type="text"
                      placeholder="URL API (https://...)"
                      className="input input-bordered input-xs w-full text-xs font-mono"
                      value={step.url || ''}
                      onChange={e => updateStep(idx, 'url', e.target.value)}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Connection Modal (transition settings) */}
      {showConnectModal && (
        <div className="modal modal-open">
          <div className="modal-box max-w-sm">
            <h3 className="font-bold text-md mb-2">Tentukan Jalur Koneksi</h3>
            <div className="form-control gap-2">
              <label className="flex items-center gap-2 cursor-pointer py-1">
                <input
                  type="radio"
                  name="transition"
                  className="radio radio-primary radio-sm"
                  checked={transitionType === 'option'}
                  onChange={() => setTransitionType('option')}
                />
                <span className="text-xs">Input Pilihan User (Contoh: "1", "2")</span>
              </label>

              {transitionType === 'option' && (
                <input
                  type="text"
                  placeholder="Isi input pilihan (kosongkan untuk wildcard '*')"
                  className="input input-sm input-bordered w-full mt-1 text-xs"
                  value={optionValue}
                  onChange={e => setOptionValue(e.target.value)}
                />
              )}

              <label className="flex items-center gap-2 cursor-pointer py-1">
                <input
                  type="radio"
                  name="transition"
                  className="radio radio-primary radio-sm"
                  checked={transitionType === 'fallback'}
                  onChange={() => setTransitionType('fallback')}
                />
                <span className="text-xs">Fallback (Bila input user tidak cocok)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer py-1">
                <input
                  type="radio"
                  name="transition"
                  className="radio radio-primary radio-sm"
                  checked={transitionType === 'success'}
                  onChange={() => setTransitionType('success')}
                />
                <span className="text-xs">Bila API Sukses (API Success)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer py-1">
                <input
                  type="radio"
                  name="transition"
                  className="radio radio-primary radio-sm"
                  checked={transitionType === 'failure'}
                  onChange={() => setTransitionType('failure')}
                />
                <span className="text-xs">Bila API Gagal (API Failure)</span>
              </label>
            </div>

            <div className="modal-action">
              <button className="btn btn-sm btn-ghost" onClick={() => setShowConnectModal(false)}>Batal</button>
              <button className="btn btn-sm btn-primary" onClick={confirmConnection}>Hubungkan</button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Simulator Modal Overlay */}
      {simulatorOpen && (
        <div className="modal modal-open">
          <div className="modal-box max-w-md h-[550px] flex flex-col p-4 bg-base-100 shadow-2xl rounded-2xl relative">
            <div className="flex justify-between items-center border-b border-base-300 pb-2 mb-3">
              <div className="flex flex-col">
                <h3 className="font-bold text-sm">Simulator Chatbot 💬</h3>
                <span className="text-[10px] opacity-60">State: <strong className="font-mono text-primary">{simBotState}</strong> | Status: {simBotActive ? 'Bot Aktif' : 'Off (CS)'}</span>
              </div>
              <button className="btn btn-xs btn-ghost" onClick={() => setSimulatorOpen(false)}>✕ Close</button>
            </div>

            <div className="flex-1 overflow-y-auto flex flex-col gap-2 p-2 bg-base-200 rounded-lg">
              {simMessages.map(msg => (
                <div key={msg.id} className={`chat ${
                  msg.sender_type === 'Contact' ? 'chat-end' :
                  msg.sender_type === 'System' ? 'chat-center text-[11px] text-base-content/50 bg-black/5 py-1 px-2 rounded-lg max-w-[90%] mx-auto font-mono' : 'chat-start'
                }`}>
                  {msg.sender_type !== 'System' && (
                    <div className={`chat-bubble text-xs ${msg.sender_type === 'Contact' ? 'chat-bubble-primary' : 'bg-base-100 text-base-content border border-base-300'}`}>
                      {msg.content}
                    </div>
                  )}
                  {msg.sender_type === 'System' && (
                    <span>{msg.content}</span>
                  )}
                </div>
              ))}
            </div>

            <form onSubmit={handleSimSend} className="flex gap-2 mt-3 pt-2 border-t border-base-200">
              <button type="button" className="btn btn-xs btn-outline btn-error" onClick={resetSimulator}>Reset</button>
              <input
                type="text"
                placeholder="Ketik pesan pilihan..."
                className="input input-sm input-bordered flex-1 text-xs"
                value={simInput}
                onChange={e => setSimInput(e.target.value)}
              />
              <button type="submit" className="btn btn-sm btn-primary">Kirim</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
