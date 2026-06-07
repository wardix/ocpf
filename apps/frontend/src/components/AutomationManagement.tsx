import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { useToastStore } from '../store/toastStore';

interface Action {
  type: 'add_label' | 'assign_agent' | 'send_reply' | 'change_status';
  label_id?: number;
  agent_id?: number;
  content?: string;
  status?: 'open' | 'pending' | 'resolved';
}

interface TriggerConfig {
  keywords?: string[];
  match_type?: 'contains' | 'exact' | 'regex';
  idle_minutes?: number;
  from_status?: 'open' | 'pending' | 'snoozed' | 'resolved' | '';
  to_status?: 'open' | 'pending' | 'snoozed' | 'resolved' | '';
}

interface Rule {
  id?: number;
  name: string;
  description: string;
  trigger_type: 'message.incoming' | 'ticket.idle' | 'status.changed' | 'contact.created';
  trigger_config: TriggerConfig;
  actions: Action[];
  is_active: boolean;
  priority: number;
  execution_count?: number;
  last_executed_at?: string;
}

const AutomationManagement = () => {
  const { token } = useAuthStore();
  const { addToast } = useToastStore();
  const [rules, setRules] = useState<Rule[]>([]);
  const [labels, setLabels] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Modal states
  const [showBuilder, setShowBuilder] = useState(false);
  const [currentRule, setCurrentRule] = useState<Rule | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [logRuleId, setLogRuleId] = useState<number | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [logPage, setLogPage] = useState(1);
  const [logTotalPages, setLogTotalPages] = useState(1);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Form states
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formTriggerType, setFormTriggerType] = useState<Rule['trigger_type']>('message.incoming');
  const [formKeywords, setFormKeywords] = useState('');
  const [formMatchType, setFormMatchType] = useState<'contains' | 'exact' | 'regex'>('contains');
  const [formIdleMinutes, setFormIdleMinutes] = useState(30);
  const [formFromStatus, setFormFromStatus] = useState<TriggerConfig['from_status']>('');
  const [formToStatus, setFormToStatus] = useState<TriggerConfig['to_status']>('');
  const [formActions, setFormActions] = useState<Action[]>([]);
  const [saving, setSaving] = useState(false);

  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  const fetchRules = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/api/automation-rules`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) setRules(result.data || []);
      }
    } catch (err) {
      console.error('Gagal mengambil aturan otomatisasi:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchLabels = async () => {
    if (!token) return;
    try {
      const response = await fetch(`${apiUrl}/api/labels`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const result = await response.json();
        setLabels(result.data || []);
      }
    } catch (err) {
      console.error('Gagal mengambil label:', err);
    }
  };

  const fetchAgents = async () => {
    if (!token) return;
    try {
      const response = await fetch(`${apiUrl}/api/users/agents`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const result = await response.json();
        setAgents(result || []);
      }
    } catch (err) {
      console.error('Gagal mengambil agen:', err);
    }
  };

  useEffect(() => {
    fetchRules();
    fetchLabels();
    fetchAgents();
  }, [token]);

  const handleToggleActive = async (ruleId: number) => {
    if (!token) return;
    try {
      const response = await fetch(`${apiUrl}/api/automation-rules/${ruleId}/toggle`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        addToast('Status aturan berhasil diubah', 'success');
        fetchRules();
      }
    } catch (err) {
      addToast('Gagal mengubah status aturan', 'error');
    }
  };

  const handleMovePriority = async (index: number, direction: 'up' | 'down') => {
    if (!token) return;
    const newRules = [...rules];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= rules.length) return;

    // Swap elements
    const temp = newRules[index];
    newRules[index] = newRules[targetIndex];
    newRules[targetIndex] = temp;

    // Update priorities locally
    const updated = newRules.map((rule, idx) => ({
      ...rule,
      priority: idx
    }));

    setRules(updated);

    // Save priorities to DB sequentially
    try {
      await Promise.all(
        updated.map(rule => 
          fetch(`${apiUrl}/api/automation-rules/${rule.id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              name: rule.name,
              description: rule.description,
              trigger_type: rule.trigger_type,
              trigger_config: rule.trigger_config,
              actions: rule.actions,
              is_active: rule.is_active,
              priority: rule.priority
            })
          })
        )
      );
      addToast('Urutan prioritas berhasil disimpan', 'success');
    } catch (err) {
      console.error(err);
      addToast('Gagal menyimpan urutan prioritas', 'error');
      fetchRules();
    }
  };

  const openBuilder = (rule: Rule | null = null) => {
    setCurrentRule(rule);
    if (rule) {
      setFormName(rule.name);
      setFormDesc(rule.description);
      setFormTriggerType(rule.trigger_type);
      setFormKeywords(rule.trigger_config.keywords?.join(', ') || '');
      setFormMatchType(rule.trigger_config.match_type || 'contains');
      setFormIdleMinutes(rule.trigger_config.idle_minutes || 30);
      setFormFromStatus(rule.trigger_config.from_status || '');
      setFormToStatus(rule.trigger_config.to_status || '');
      setFormActions(rule.actions);
    } else {
      setFormName('');
      setFormDesc('');
      setFormTriggerType('message.incoming');
      setFormKeywords('');
      setFormMatchType('contains');
      setFormIdleMinutes(30);
      setFormFromStatus('');
      setFormToStatus('');
      setFormActions([{ type: 'send_reply', content: '' }]);
    }
    setShowBuilder(true);
  };

  const handleAddAction = () => {
    setFormActions([...formActions, { type: 'send_reply', content: '' }]);
  };

  const handleRemoveAction = (index: number) => {
    setFormActions(formActions.filter((_, i) => i !== index));
  };

  const handleActionChange = (index: number, key: keyof Action, value: any) => {
    const newActions = [...formActions];
    newActions[index] = {
      ...newActions[index],
      [key]: value
    };
    setFormActions(newActions);
  };

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSaving(true);

    // Build trigger config
    const trigger_config: TriggerConfig = {};
    if (formTriggerType === 'message.incoming' || formTriggerType === 'contact.created') {
      trigger_config.keywords = formKeywords.split(',').map(k => k.trim()).filter(Boolean);
      trigger_config.match_type = formMatchType;
    } else if (formTriggerType === 'ticket.idle') {
      trigger_config.idle_minutes = Number(formIdleMinutes);
    } else if (formTriggerType === 'status.changed') {
      if (formFromStatus) trigger_config.from_status = formFromStatus;
      if (formToStatus) trigger_config.to_status = formToStatus;
    }

    const payload = {
      name: formName,
      description: formDesc,
      trigger_type: formTriggerType,
      trigger_config,
      actions: formActions,
      is_active: currentRule ? currentRule.is_active : true,
      priority: currentRule ? currentRule.priority : rules.length
    };

    try {
      const endpoint = currentRule 
        ? `${apiUrl}/api/automation-rules/${currentRule.id}`
        : `${apiUrl}/api/automation-rules`;
      const method = currentRule ? 'PUT' : 'POST';

      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        addToast(currentRule ? 'Aturan berhasil diperbarui' : 'Aturan berhasil dibuat', 'success');
        setShowBuilder(false);
        fetchRules();
      } else {
        const result = await response.json();
        addToast(result.error || 'Gagal menyimpan aturan', 'error');
      }
    } catch (err) {
      console.error(err);
      addToast('Gagal menghubungi server', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRule = async (ruleId: number) => {
    if (!confirm('Apakah Anda yakin ingin menghapus aturan otomatisasi ini?')) return;
    if (!token) return;

    try {
      const response = await fetch(`${apiUrl}/api/automation-rules/${ruleId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        addToast('Aturan berhasil dihapus', 'success');
        fetchRules();
      }
    } catch (err) {
      addToast('Gagal menghapus aturan', 'error');
    }
  };

  const fetchLogs = async (ruleId: number, page = 1) => {
    if (!token) return;
    setLoadingLogs(true);
    try {
      const response = await fetch(`${apiUrl}/api/automation-rules/${ruleId}/logs?page=${page}&per_page=5`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setLogs(result.data || []);
          setLogTotalPages(Math.ceil((result.meta?.total || 0) / (result.meta?.per_page || 5)));
          setLogPage(page);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingLogs(false);
    }
  };

  const openLogs = (ruleId: number) => {
    setLogRuleId(ruleId);
    setLogs([]);
    setLogPage(1);
    fetchLogs(ruleId, 1);
    setShowLogs(true);
  };

  return (
    <div className="card bg-base-100 shadow-sm border border-base-300">
      <div className="card-body">
        <div className="flex justify-between items-center mb-1">
          <h2 className="card-title text-xl flex items-center gap-2">
            🤖 Aturan Otomatisasi (Automation Rules)
          </h2>
          <button onClick={() => openBuilder()} className="btn btn-sm btn-primary">
            ➕ Buat Aturan
          </button>
        </div>
        <p className="text-sm text-base-content/60 mb-6">
          Definisikan aturan otomatis berdasarkan pemicu (triggers) pesan masuk, tiket diam, atau perubahan status untuk melancarkan alur kerja operasional.
        </p>

        {loading && rules.length === 0 ? (
          <div className="flex justify-center py-6">
            <span className="loading loading-spinner loading-md text-primary"></span>
          </div>
        ) : rules.length === 0 ? (
          <div className="text-center py-8 bg-base-200/50 rounded-xl border border-dashed border-base-300">
            <span className="text-4xl mb-2 block">🤖</span>
            <p className="text-sm italic opacity-60">Belum ada aturan otomatisasi terkonfigurasi.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-sm w-full border border-base-200">
              <thead className="bg-base-200">
                <tr>
                  <th className="w-12 text-center">Urutan</th>
                  <th>Nama Aturan</th>
                  <th>Pemicu (Trigger)</th>
                  <th className="w-20 text-center">Eksekusi</th>
                  <th className="w-24 text-center">Aktif</th>
                  <th className="w-40 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule, index) => (
                  <tr key={rule.id} className="hover">
                    <td>
                      <div className="flex flex-col gap-0.5 items-center">
                        <button 
                          onClick={() => handleMovePriority(index, 'up')}
                          disabled={index === 0}
                          className="btn btn-ghost btn-xs p-0 h-4 min-h-4 disabled:opacity-30"
                          title="Naikkan Prioritas"
                        >
                          ▲
                        </button>
                        <span className="text-xs font-bold font-mono">{index + 1}</span>
                        <button 
                          onClick={() => handleMovePriority(index, 'down')}
                          disabled={index === rules.length - 1}
                          className="btn btn-ghost btn-xs p-0 h-4 min-h-4 disabled:opacity-30"
                          title="Turunkan Prioritas"
                        >
                          ▼
                        </button>
                      </div>
                    </td>
                    <td>
                      <div>
                        <div className="font-bold text-sm">{rule.name}</div>
                        <div className="text-xs text-base-content/60 truncate max-w-xs">{rule.description || 'Tidak ada deskripsi'}</div>
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-outline badge-neutral badge-xs font-mono py-1.5 px-2">
                        {rule.trigger_type}
                      </span>
                    </td>
                    <td className="text-center font-mono text-xs">
                      {rule.execution_count || 0}
                    </td>
                    <td className="text-center">
                      <input 
                        type="checkbox" 
                        className="toggle toggle-primary toggle-xs"
                        checked={rule.is_active}
                        onChange={() => rule.id && handleToggleActive(rule.id)}
                      />
                    </td>
                    <td className="text-right">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => rule.id && openLogs(rule.id)} className="btn btn-xs btn-outline">Log</button>
                        <button onClick={() => openBuilder(rule)} className="btn btn-xs btn-outline btn-neutral">Edit</button>
                        <button onClick={() => rule.id && handleDeleteRule(rule.id)} className="btn btn-xs btn-outline btn-error">Hapus</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Builder Modal */}
      {showBuilder && (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-2xl shadow-2xl border border-base-300 rounded-2xl bg-base-100 p-6">
            <h3 className="font-bold text-lg mb-1 flex items-center gap-2">
              🤖 {currentRule ? 'Edit Aturan Otomatisasi' : 'Buat Aturan Otomatisasi Baru'}
            </h3>
            <p className="text-xs text-base-content/50 mb-6">Tentukan kondisi pemicu dan rentetan aksi yang akan dieksekusi secara berurutan.</p>

            <form onSubmit={handleSaveRule} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="form-control w-full">
                  <label className="label py-1"><span className="label-text text-xs font-semibold">Nama Aturan</span></label>
                  <input 
                    type="text" 
                    className="input input-sm input-bordered w-full"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    placeholder="misal: Auto-reply Tanya Price List"
                    required
                  />
                </div>
                <div className="form-control w-full">
                  <label className="label py-1"><span className="label-text text-xs font-semibold">Deskripsi Singkat</span></label>
                  <input 
                    type="text" 
                    className="input input-sm input-bordered w-full"
                    value={formDesc}
                    onChange={e => setFormDesc(e.target.value)}
                    placeholder="misal: Kirim penawaran harga jika mendeteksi kata price"
                  />
                </div>
              </div>

              <div className="divider text-xs opacity-50 py-0 my-2">KONDISI PEMICU (TRIGGER)</div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-base-200/50 p-4 rounded-xl border border-base-300">
                <div className="form-control w-full">
                  <label className="label py-1"><span className="label-text text-xs font-semibold">Jenis Pemicu</span></label>
                  <select 
                    className="select select-sm select-bordered w-full"
                    value={formTriggerType}
                    onChange={e => setFormTriggerType(e.target.value as Rule['trigger_type'])}
                  >
                    <option value="message.incoming">Pesan Masuk (message.incoming)</option>
                    <option value="ticket.idle">Tiket Diam/Idle (ticket.idle)</option>
                    <option value="status.changed">Status Berubah (status.changed)</option>
                    <option value="contact.created">Kontak Baru (contact.created)</option>
                  </select>
                </div>

                {/* Trigger Configs */}
                {(formTriggerType === 'message.incoming' || formTriggerType === 'contact.created') && (
                  <>
                    <div className="form-control w-full col-span-2 md:col-span-1">
                      <label className="label py-1">
                        <span className="label-text text-xs font-semibold">Kata Kunci (Keywords)</span>
                      </label>
                      <input 
                        type="text" 
                        className="input input-sm input-bordered w-full"
                        value={formKeywords}
                        onChange={e => setFormKeywords(e.target.value)}
                        placeholder="koma-separated, misal: harga, price, promo"
                      />
                      <label className="label py-0.5">
                        <span className="label-text-alt text-[9px] text-base-content/40">Kosongkan untuk mencocokkan semua</span>
                      </label>
                    </div>

                    <div className="form-control w-full">
                      <label className="label py-1"><span className="label-text text-xs font-semibold">Pencocokan</span></label>
                      <select 
                        className="select select-sm select-bordered w-full"
                        value={formMatchType}
                        onChange={e => setFormMatchType(e.target.value as any)}
                      >
                        <option value="contains">Mengandung kata kunci</option>
                        <option value="exact">Cocok persis</option>
                        <option value="regex">Regular Expression (Regex)</option>
                      </select>
                    </div>
                  </>
                )}

                {formTriggerType === 'ticket.idle' && (
                  <div className="form-control w-full col-span-2">
                    <label className="label py-1"><span className="label-text text-xs font-semibold">Durasi Diam (Menit)</span></label>
                    <input 
                      type="number" 
                      min={1}
                      max={1440}
                      className="input input-sm input-bordered w-full"
                      value={formIdleMinutes}
                      onChange={e => setFormIdleMinutes(parseInt(e.target.value, 10) || 30)}
                      required
                    />
                    <label className="label py-0.5">
                      <span className="label-text-alt text-[9px] text-base-content/40">Tiket aktif tanpa respon selama X menit akan memicu aksi.</span>
                    </label>
                  </div>
                )}

                {formTriggerType === 'status.changed' && (
                  <>
                    <div className="form-control w-full">
                      <label className="label py-1"><span className="label-text text-xs font-semibold">Dari Status</span></label>
                      <select 
                        className="select select-sm select-bordered w-full"
                        value={formFromStatus}
                        onChange={e => setFormFromStatus(e.target.value as any)}
                      >
                        <option value="">Status Apa Saja</option>
                        <option value="open">Open</option>
                        <option value="pending">Pending</option>
                        <option value="snoozed">Snoozed</option>
                        <option value="resolved">Resolved</option>
                      </select>
                    </div>
                    <div className="form-control w-full col-span-2 md:col-span-2">
                      <label className="label py-1"><span className="label-text text-xs font-semibold">Menjadi Status</span></label>
                      <select 
                        className="select select-sm select-bordered w-full"
                        value={formToStatus}
                        onChange={e => setFormToStatus(e.target.value as any)}
                      >
                        <option value="">Status Apa Saja</option>
                        <option value="open">Open</option>
                        <option value="pending">Pending</option>
                        <option value="snoozed">Snoozed</option>
                        <option value="resolved">Resolved</option>
                      </select>
                    </div>
                  </>
                )}
              </div>

              <div className="divider text-xs opacity-50 py-0 my-2">URUTAN AKSI YANG DIEKSEKUSI (ACTIONS)</div>

              <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                {formActions.map((action, index) => (
                  <div key={index} className="flex items-start gap-3 bg-base-200/30 p-3 rounded-xl border border-base-300 relative">
                    <div className="badge badge-neutral text-xs font-bold w-6 h-6 rounded-full shrink-0 flex items-center justify-center mt-1">
                      {index + 1}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">
                      <div className="form-control w-full">
                        <label className="label py-0.5"><span className="label-text text-[10px] font-bold text-base-content/50">Jenis Aksi</span></label>
                        <select 
                          className="select select-sm select-bordered w-full"
                          value={action.type}
                          onChange={e => handleActionChange(index, 'type', e.target.value)}
                        >
                          <option value="send_reply">Kirim Balasan Otomatis</option>
                          <option value="add_label">Tambah Label / Tag</option>
                          <option value="assign_agent">Tugaskan ke Agen</option>
                          <option value="change_status">Ubah Status Tiket</option>
                        </select>
                      </div>

                      {/* Action parameters based on type */}
                      {action.type === 'send_reply' && (
                        <div className="form-control w-full">
                          <label className="label py-0.5"><span className="label-text text-[10px] font-bold text-base-content/50">Isi Pesan</span></label>
                          <textarea 
                            className="textarea textarea-xs textarea-bordered w-full h-16 resize-none"
                            value={action.content || ''}
                            onChange={e => handleActionChange(index, 'content', e.target.value)}
                            placeholder="Masukkan pesan penawaran / sapaan..."
                            required
                          ></textarea>
                        </div>
                      )}

                      {action.type === 'add_label' && (
                        <div className="form-control w-full">
                          <label className="label py-0.5"><span className="label-text text-[10px] font-bold text-base-content/50">Pilih Label</span></label>
                          <select 
                            className="select select-sm select-bordered w-full"
                            value={action.label_id || ''}
                            onChange={e => handleActionChange(index, 'label_id', Number(e.target.value))}
                            required
                          >
                            <option value="">Pilih Label...</option>
                            {labels.map(l => (
                              <option key={l.id} value={l.id}>{l.title}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {action.type === 'assign_agent' && (
                        <div className="form-control w-full">
                          <label className="label py-0.5"><span className="label-text text-[10px] font-bold text-base-content/50">Pilih Agen</span></label>
                          <select 
                            className="select select-sm select-bordered w-full"
                            value={action.agent_id || ''}
                            onChange={e => handleActionChange(index, 'agent_id', Number(e.target.value))}
                            required
                          >
                            <option value="">Pilih Agen...</option>
                            {agents.map(a => (
                              <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {action.type === 'change_status' && (
                        <div className="form-control w-full">
                          <label className="label py-0.5"><span className="label-text text-[10px] font-bold text-base-content/50">Pilih Status Baru</span></label>
                          <select 
                            className="select select-sm select-bordered w-full"
                            value={action.status || 'open'}
                            onChange={e => handleActionChange(index, 'status', e.target.value)}
                            required
                          >
                            <option value="open">Open</option>
                            <option value="pending">Pending</option>
                            <option value="resolved">Resolved</option>
                          </select>
                        </div>
                      )}
                    </div>

                    <button 
                      type="button" 
                      onClick={() => handleRemoveAction(index)}
                      className="btn btn-ghost btn-circle btn-xs text-error absolute top-2 right-2"
                      title="Hapus Aksi"
                      disabled={formActions.length === 1}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex justify-start">
                <button 
                  type="button" 
                  onClick={handleAddAction}
                  className="btn btn-xs btn-outline btn-primary mt-1"
                >
                  ➕ Tambah Aksi ke Stack
                </button>
              </div>

              <div className="modal-action gap-2 mt-6">
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowBuilder(false)}>Batal</button>
                <button 
                  type="submit" 
                  className={`btn btn-sm btn-primary ${saving ? 'loading' : ''}`}
                  disabled={saving || formActions.length === 0}
                >
                  Simpan Aturan
                </button>
              </div>
            </form>
          </div>
          <form method="dialog" className="modal-backdrop bg-base-300/40 backdrop-blur-sm" onClick={() => setShowBuilder(false)}>
            <button>close</button>
          </form>
        </dialog>
      )}

      {/* Logs Modal */}
      {showLogs && (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-xl shadow-2xl border border-base-300 rounded-2xl p-6 bg-base-100">
            <h3 className="font-bold text-lg mb-1 flex items-center gap-2">
              📋 Log Eksekusi Aturan
            </h3>
            <p className="text-xs text-base-content/50 mb-6">Histori penanganan otomatis yang berhasil atau gagal.</p>

            {loadingLogs ? (
              <div className="flex justify-center py-8">
                <span className="loading loading-spinner loading-md text-primary"></span>
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-6 text-sm text-base-content/50 italic">
                Belum ada data eksekusi untuk aturan ini.
              </div>
            ) : (
              <div className="space-y-4">
                {logs.map((log) => (
                  <div key={log.id} className="p-3 bg-base-200/50 rounded-xl border border-base-300 text-xs space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="font-bold font-mono">{new Date(log.created_at).toLocaleString('id-ID')}</span>
                      <span className={`badge badge-sm uppercase font-bold text-[9px] ${log.status === 'success' ? 'badge-success' : log.status === 'partial_failure' ? 'badge-warning' : 'badge-error'}`}>
                        {log.status}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <span className="opacity-60">ID Tiket:</span>
                      <span className="font-bold font-mono">#{log.ticket_id || 'N/A'}</span>
                      <span className="opacity-40">|</span>
                      <span className="opacity-60">Latency:</span>
                      <span className="font-bold font-mono">{log.execution_time_ms}ms</span>
                    </div>

                    {log.actions_executed && log.actions_executed.length > 0 && (
                      <div>
                        <span className="font-bold text-success text-[10px] block mb-1">Aksi Berhasil:</span>
                        <ul className="list-disc pl-4 space-y-0.5 opacity-80">
                          {log.actions_executed.map((act: any, i: number) => {
                            const parsedAct = typeof act === 'string' ? JSON.parse(act) : act;
                            return (
                              <li key={i}>
                                {parsedAct.type} {parsedAct.status ? `-> ${parsedAct.status}` : ''} {parsedAct.content ? `("${parsedAct.content.substring(0, 20)}...")` : ''}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}

                    {log.actions_failed && log.actions_failed.length > 0 && (
                      <div>
                        <span className="font-bold text-error text-[10px] block mb-1">Aksi Gagal:</span>
                        <ul className="list-disc pl-4 space-y-0.5 opacity-80 text-error">
                          {log.actions_failed.map((act: any, i: number) => {
                            const parsedAct = typeof act === 'string' ? JSON.parse(act) : act;
                            return (
                              <li key={i}>
                                {parsedAct.type}: <span className="italic">{parsedAct.error}</span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}

                {/* Pagination */}
                <div className="flex justify-between items-center mt-6">
                  <span className="text-xs opacity-70">Halaman {logPage} dari {logTotalPages || 1}</span>
                  <div className="btn-group">
                    <button 
                      className="btn btn-xs btn-outline" 
                      onClick={() => logRuleId && fetchLogs(logRuleId, logPage - 1)}
                      disabled={logPage === 1}
                    >
                      « Prev
                    </button>
                    <button 
                      className="btn btn-xs btn-outline" 
                      onClick={() => logRuleId && fetchLogs(logRuleId, logPage + 1)}
                      disabled={logPage >= logTotalPages}
                    >
                      Next »
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="modal-action mt-6">
              <button 
                className="btn btn-sm btn-outline" 
                onClick={() => setShowLogs(false)}
              >
                Tutup Log
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop bg-base-300/40 backdrop-blur-sm" onClick={() => setShowLogs(false)}>
            <button>close</button>
          </form>
        </dialog>
      )}
    </div>
  );
};

export default AutomationManagement;
