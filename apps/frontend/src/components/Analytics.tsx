import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip 
} from 'recharts';

interface OverviewData {
  total_tickets: number;
  resolved_tickets: number;
  avg_frt: number;
  median_frt: number;
  avg_resolution_time: number;
  median_resolution_time: number;
}

interface VolumeDataItem {
  period: string;
  count: number;
}

interface AgentPerformanceItem {
  agent_id: number;
  agent_name: string;
  assigned_tickets: number;
  resolved_tickets: number;
  avg_csat: number;
  total_csat_responses: number;
  messages_sent: number;
}

interface CSATAnalytics {
  avg_rating: number;
  total_ratings: number;
  distribution: { rating: number; count: number }[];
  agent_performance: { name: string; avg_rating: number; total_ratings: number }[];
  response_rate: {
    surveys_sent: number;
    responses: number;
    percentage: number;
  };
}

interface CSATRatingItem {
  id: number;
  rating: number;
  feedback: string | null;
  created_at: string;
  ticket_id: number;
  agent_name: string | null;
  contact_name: string;
}

const Analytics = () => {
  const { token, user } = useAuthStore();
  
  // Date Range Filters State (Default: Last 30 Days)
  const defaultStartDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const defaultEndDate = new Date().toISOString().split('T')[0];
  
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [preset, setPreset] = useState<'today' | '7days' | '30days' | 'custom'>('30days');
  const [granularity, setGranularity] = useState<'hourly' | 'daily' | 'weekly'>('daily');

  // Tab State
  const [activeTab, setActiveTab] = useState<'general' | 'csat'>('general');

  // General Analytics Data States
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [volume, setVolume] = useState<VolumeDataItem[]>([]);
  const [agents, setAgents] = useState<AgentPerformanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // CSAT States
  const [csatData, setCsatData] = useState<CSATAnalytics | null>(null);
  const [ratingsList, setRatingsList] = useState<CSATRatingItem[]>([]);
  const [csatPage, setCsatPage] = useState(1);
  const [csatTotalPages, setCsatTotalPages] = useState(1);
  const [loadingCsat, setLoadingCsat] = useState(false);

  // Sorting Leaderboard State
  const [sortField, setSortField] = useState<string>('resolved_tickets');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const formatDuration = (seconds: number): string => {
    if (seconds === undefined || seconds === null || isNaN(seconds) || seconds <= 0) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    const parts = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (h === 0 && m === 0 && s > 0) parts.push(`${s}s`);

    return parts.join(' ') || '0s';
  };

  const handlePresetChange = (selectedPreset: 'today' | '7days' | '30days' | 'custom') => {
    setPreset(selectedPreset);
    if (selectedPreset === 'custom') return;

    const end = new Date();
    let start = new Date();

    if (selectedPreset === 'today') {
      start.setHours(0, 0, 0, 0);
      setGranularity('hourly');
    } else if (selectedPreset === '7days') {
      start.setDate(end.getDate() - 7);
      setGranularity('daily');
    } else if (selectedPreset === '30days') {
      start.setDate(end.getDate() - 30);
      setGranularity('daily');
    }

    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(end.toISOString().split('T')[0]);
  };

  const fetchGeneralAnalytics = async () => {
    if (!token) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const queryParams = `?start_date=${startDate}&end_date=${endDate}`;
      
      // Fetch overview, volume, and agents in parallel
      const [resOverview, resVolume, resAgents] = await Promise.all([
        fetch(`${apiUrl}/api/analytics/overview${queryParams}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${apiUrl}/api/analytics/volume${queryParams}&granularity=${granularity}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${apiUrl}/api/analytics/agents${queryParams}`, { headers: { 'Authorization': `Bearer ${token}` } })
      ]);

      if (resOverview.ok && resVolume.ok && resAgents.ok) {
        const outOverview = await resOverview.json();
        const outVolume = await resVolume.json();
        const outAgents = await resAgents.json();
        
        setOverview(outOverview.data);
        setVolume(outVolume.data);
        setAgents(outAgents.data);
      } else {
        setErrorMsg('Gagal mengambil data analitik dari server');
      }
    } catch (err) {
      console.error('Gagal mengambil data analitik:', err);
      setErrorMsg('Terjadi kesalahan jaringan.');
    } finally {
      setLoading(false);
    }
  };

  const fetchCSATAnalytics = async () => {
    if (!token) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const queryParams = `?start_date=${startDate}&end_date=${endDate}`;
      const response = await fetch(`${apiUrl}/api/analytics/csat${queryParams}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) setCsatData(result.data);
      }
    } catch (err) {
      console.error('Gagal mengambil data CSAT:', err);
    }
  };

  const fetchCSATRatingsList = async (page = 1) => {
    if (!token) return;
    setLoadingCsat(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const queryParams = `?start_date=${startDate}&end_date=${endDate}&page=${page}&per_page=10`;
      const response = await fetch(`${apiUrl}/api/analytics/csat/ratings${queryParams}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setRatingsList(result.data);
          setCsatTotalPages(Math.ceil(result.meta.total / result.meta.per_page));
        }
      }
    } catch (err) {
      console.error('Gagal mengambil daftar rating CSAT:', err);
    } finally {
      setLoadingCsat(false);
    }
  };

  useEffect(() => {
    if (token) {
      if (activeTab === 'general') {
        fetchGeneralAnalytics();
      } else {
        fetchCSATAnalytics();
        fetchCSATRatingsList(csatPage);
      }
    }
  }, [token, activeTab, startDate, endDate, granularity, csatPage]);

  const handleManualRefresh = () => {
    if (activeTab === 'general') {
      fetchGeneralAnalytics();
    } else {
      fetchCSATAnalytics();
      fetchCSATRatingsList(csatPage);
    }
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const getSortedAgents = () => {
    return [...agents].sort((a, b) => {
      let valA: any = a[sortField as keyof AgentPerformanceItem];
      let valB: any = b[sortField as keyof AgentPerformanceItem];

      if (typeof valA === 'string') {
        valA = valA.toLowerCase();
        valB = valB.toLowerCase();
      } else {
        valA = Number(valA) || 0;
        valB = Number(valB) || 0;
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const renderSortIcon = (field: string) => {
    if (sortField !== field) return <span className="opacity-30">⇅</span>;
    return sortDirection === 'asc' ? '▲' : '▼';
  };

  const renderStars = (rating: number) => {
    return (
      <div className="flex gap-0.5 text-warning text-xs">
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} className="text-sm">
            {i < rating ? '★' : '☆'}
          </span>
        ))}
      </div>
    );
  };

  const formatChartDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      if (granularity === 'hourly') {
        return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      }
      return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    } catch {
      return dateString;
    }
  };

  if (user?.role !== 'administrator') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-base-200 p-8 text-center">
        <span className="text-6xl mb-4">⛔</span>
        <h1 className="text-2xl font-bold text-error">Akses Ditolak</h1>
        <p className="text-base-content/60 mt-2 max-w-md">
          Pengaturan halaman analitik canggih hanya dapat diakses oleh staf yang berwenang sebagai Administrator.
        </p>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-base-200 p-8">
        <span className="text-4xl mb-4">⚠️</span>
        <h2 className="text-xl font-bold text-error">{errorMsg}</h2>
        <button className="btn btn-primary btn-sm mt-4" onClick={handleManualRefresh}>Coba Lagi</button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-base-200 h-full overflow-y-auto p-6 md:p-8">
      <div className="max-w-6xl w-full mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4 bg-base-100 p-6 rounded-2xl border border-base-300 shadow-sm">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">📊 Dasbor Analitik</h1>
            <p className="text-base-content/60 mt-1">Pantau First Response Time, Resolution Time, volume percakapan, dan skor CSAT.</p>
          </div>
          <div className="flex gap-2 self-start md:self-end">
            <div className="tabs tabs-boxed bg-base-200 border border-base-300">
              <button 
                className={`tab tab-sm ${activeTab === 'general' ? 'tab-active font-semibold' : ''}`}
                onClick={() => setActiveTab('general')}
              >
                📈 Performa & Tren
              </button>
              <button 
                className={`tab tab-sm ${activeTab === 'csat' ? 'tab-active font-semibold' : ''}`}
                onClick={() => setActiveTab('csat')}
              >
                ⭐ Kepuasan (CSAT)
              </button>
            </div>
          </div>
        </div>

        {/* Global Date Range Filter Control */}
        <div className="card bg-base-100 border border-base-300 shadow-sm">
          <div className="card-body p-4 flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-base-content/75 uppercase tracking-wide">Rentang Waktu:</span>
              <button 
                className={`btn btn-xs ${preset === 'today' ? 'btn-primary' : 'btn-ghost bg-base-200'}`}
                onClick={() => handlePresetChange('today')}
              >
                Hari Ini
              </button>
              <button 
                className={`btn btn-xs ${preset === '7days' ? 'btn-primary' : 'btn-ghost bg-base-200'}`}
                onClick={() => handlePresetChange('7days')}
              >
                7 Hari Terakhir
              </button>
              <button 
                className={`btn btn-xs ${preset === '30days' ? 'btn-primary' : 'btn-ghost bg-base-200'}`}
                onClick={() => handlePresetChange('30days')}
              >
                30 Hari Terakhir
              </button>
              <button 
                className={`btn btn-xs ${preset === 'custom' ? 'btn-primary' : 'btn-ghost bg-base-200'}`}
                onClick={() => setPreset('custom')}
              >
                Kustom
              </button>
            </div>

            {preset === 'custom' && (
              <div className="flex items-center gap-2 bg-base-200/50 p-2 rounded-xl border border-base-300">
                <input 
                  type="date" 
                  className="input input-xs input-bordered" 
                  value={startDate} 
                  onChange={e => setStartDate(e.target.value)} 
                />
                <span className="text-xs opacity-60">s.d</span>
                <input 
                  type="date" 
                  className="input input-xs input-bordered" 
                  value={endDate} 
                  onChange={e => setEndDate(e.target.value)} 
                />
              </div>
            )}

            <div className="flex items-center gap-3">
              {activeTab === 'general' && (
                <div className="flex items-center gap-1">
                  <span className="text-xs opacity-70">Tren:</span>
                  <select 
                    className="select select-xs select-bordered font-semibold"
                    value={granularity}
                    onChange={e => setGranularity(e.target.value as any)}
                  >
                    <option value="hourly">Per Jam</option>
                    <option value="daily">Per Hari</option>
                    <option value="weekly">Per Minggu</option>
                  </select>
                </div>
              )}
              <button 
                className={`btn btn-xs btn-outline ${loading || loadingCsat ? 'loading' : ''}`}
                onClick={handleManualRefresh}
                disabled={loading || loadingCsat}
              >
                🔄 Refresh
              </button>
            </div>
          </div>
        </div>

        {/* Tab 1: General Analytics */}
        {activeTab === 'general' && (
          <>
            {loading && !overview ? (
              <div className="flex justify-center items-center py-20 bg-base-100 rounded-2xl border border-base-300 shadow-sm">
                <span className="loading loading-spinner loading-lg text-primary"></span>
              </div>
            ) : overview && (
              <>
                {/* Stats Row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-base-100 p-5 rounded-2xl border border-base-300 shadow-sm flex flex-col justify-between">
                    <div>
                      <span className="text-xs font-semibold opacity-60 uppercase tracking-wide">Total Tiket</span>
                      <p className="text-3xl font-extrabold text-primary mt-1">{overview.total_tickets}</p>
                    </div>
                    <span className="text-[10px] opacity-50 mt-3">Jumlah tiket masuk terkumpul</span>
                  </div>

                  <div className="bg-base-100 p-5 rounded-2xl border border-base-300 shadow-sm flex flex-col justify-between">
                    <div>
                      <span className="text-xs font-semibold opacity-60 uppercase tracking-wide">Tiket Diselesaikan</span>
                      <p className="text-3xl font-extrabold text-success mt-1">{overview.resolved_tickets}</p>
                    </div>
                    <span className="text-[10px] opacity-50 mt-3">
                      Rasio: {overview.total_tickets > 0 ? Math.round((overview.resolved_tickets / overview.total_tickets) * 100) : 0}% selesai
                    </span>
                  </div>

                  <div className="bg-base-100 p-5 rounded-2xl border border-base-300 shadow-sm flex flex-col justify-between">
                    <div>
                      <span className="text-xs font-semibold opacity-60 uppercase tracking-wide">First Response Time (FRT)</span>
                      <p className="text-2xl font-extrabold text-info mt-1">{formatDuration(overview.avg_frt)}</p>
                    </div>
                    <span className="text-[10px] opacity-50 mt-3">
                      Median: {formatDuration(overview.median_frt)} (Bebas pencilan)
                    </span>
                  </div>

                  <div className="bg-base-100 p-5 rounded-2xl border border-base-300 shadow-sm flex flex-col justify-between">
                    <div>
                      <span className="text-xs font-semibold opacity-60 uppercase tracking-wide">Waktu Penyelesaian</span>
                      <p className="text-2xl font-extrabold text-warning mt-1">{formatDuration(overview.avg_resolution_time)}</p>
                    </div>
                    <span className="text-[10px] opacity-50 mt-3">
                      Median: {formatDuration(overview.median_resolution_time)}
                    </span>
                  </div>
                </div>

                {/* Chart: Volume Trend */}
                <div className="card bg-base-100 border border-base-300 shadow-sm">
                  <div className="card-body">
                    <h2 className="card-title text-lg mb-4 flex items-center gap-2">📈 Tren Volume Tiket</h2>
                    <div className="w-full h-80">
                      {volume.length === 0 ? (
                        <div className="w-full h-full flex items-center justify-center italic opacity-50">
                          Tidak ada data volume tiket untuk rentang waktu ini.
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart 
                            data={volume} 
                            margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                          >
                            <defs>
                              <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="var(--p, #570df8)" stopOpacity={0.3}/>
                                <stop offset="95%" stopColor="var(--p, #570df8)" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                            <XAxis 
                              dataKey="period" 
                              tickFormatter={formatChartDate} 
                              tick={{ fontSize: 10 }}
                              stroke="currentColor"
                              opacity={0.4}
                            />
                            <YAxis 
                              tick={{ fontSize: 10 }}
                              stroke="currentColor"
                              opacity={0.4}
                            />
                            <Tooltip 
                              labelFormatter={(label) => new Date(label).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: granularity === 'hourly' ? 'short' : undefined })}
                              contentStyle={{ background: 'var(--b3, #2a303c)', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '12px' }}
                            />
                            <Area 
                              type="monotone" 
                              dataKey="count" 
                              name="Tiket Masuk" 
                              stroke="var(--p, #570df8)" 
                              strokeWidth={2}
                              fillOpacity={1} 
                              fill="url(#colorCount)" 
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>
                </div>

                {/* Sortable Agent Leaderboard */}
                <div className="card bg-base-100 border border-base-300 shadow-sm">
                  <div className="card-body">
                    <h2 className="card-title text-lg mb-2">🏆 Papan Peringkat Produktivitas Agen</h2>
                    <p className="text-xs text-base-content/50 mb-4">Urutkan performa berdasarkan metrik dengan mengetuk tajuk kolom.</p>
                    <div className="overflow-x-auto">
                      <table className="table table-zebra table-sm w-full border border-base-200">
                        <thead className="bg-base-200">
                          <tr>
                            <th className="cursor-pointer" onClick={() => handleSort('agent_name')}>
                              Agen {renderSortIcon('agent_name')}
                            </th>
                            <th className="text-right cursor-pointer" onClick={() => handleSort('assigned_tickets')}>
                              Tiket Masuk {renderSortIcon('assigned_tickets')}
                            </th>
                            <th className="text-right cursor-pointer" onClick={() => handleSort('resolved_tickets')}>
                              Tiket Selesai {renderSortIcon('resolved_tickets')}
                            </th>
                            <th className="text-right cursor-pointer" onClick={() => handleSort('messages_sent')}>
                              Pesan Terkirim {renderSortIcon('messages_sent')}
                            </th>
                            <th className="text-center cursor-pointer" onClick={() => handleSort('avg_csat')}>
                              Rerata CSAT {renderSortIcon('avg_csat')}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {agents.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="text-center opacity-50 py-4">Belum ada aktivitas agen</td>
                            </tr>
                          ) : (
                            getSortedAgents().map((agent) => (
                              <tr key={agent.agent_id} className="hover">
                                <td className="font-semibold flex items-center gap-2 py-3">
                                  <div className="avatar placeholder">
                                    <div className="bg-neutral text-neutral-content rounded-full w-7">
                                      <span className="text-[10px]">{agent.agent_name.substring(0, 2).toUpperCase()}</span>
                                    </div>
                                  </div>
                                  {agent.agent_name}
                                </td>
                                <td className="text-right font-mono">{agent.assigned_tickets}</td>
                                <td className="text-right font-mono text-success font-bold">+{agent.resolved_tickets}</td>
                                <td className="text-right font-mono">{agent.messages_sent}</td>
                                <td className="text-center">
                                  <div className="flex flex-col items-center">
                                    <span className="font-bold text-warning font-mono">
                                      {agent.avg_csat > 0 ? agent.avg_csat.toFixed(2) : '-'}
                                    </span>
                                    {agent.avg_csat > 0 && renderStars(Math.round(agent.avg_csat))}
                                  </div>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* Tab 2: CSAT Analytics */}
        {activeTab === 'csat' && (
          <>
            {loadingCsat && !csatData ? (
              <div className="flex justify-center items-center py-20 bg-base-100 rounded-2xl border border-base-300 shadow-sm">
                <span className="loading loading-spinner loading-lg text-primary"></span>
              </div>
            ) : csatData && (
              <>
                {/* CSAT Stats Row */}
                <div className="stats shadow w-full border border-base-300">
                  <div className="stat">
                    <div className="stat-figure text-warning">
                      <span className="text-3xl">⭐</span>
                    </div>
                    <div className="stat-title">Rata-rata Skor CSAT</div>
                    <div className="stat-value text-warning flex items-baseline gap-1">
                      {csatData.avg_rating ? csatData.avg_rating.toFixed(2) : '0.00'}
                      <span className="text-xs font-normal text-base-content/50">/ 5.0</span>
                    </div>
                    <div className="stat-desc">
                      {csatData.avg_rating >= 4.5 ? 'Sangat Baik' : csatData.avg_rating >= 3.5 ? 'Baik' : csatData.avg_rating > 0 ? 'Perlu Peningkatan' : 'Belum ada penilaian'}
                    </div>
                  </div>

                  <div className="stat">
                    <div className="stat-figure text-secondary">
                      <span className="text-3xl">📬</span>
                    </div>
                    <div className="stat-title">Tingkat Respons</div>
                    <div className="stat-value text-secondary">
                      {csatData.response_rate.percentage}%
                    </div>
                    <div className="stat-desc">
                      {csatData.response_rate.responses} dari {csatData.response_rate.surveys_sent} survei dibalas
                    </div>
                  </div>

                  <div className="stat">
                    <div className="stat-figure text-info">
                      <span className="text-3xl">👥</span>
                    </div>
                    <div className="stat-title">Total Penilaian Masuk</div>
                    <div className="stat-value text-info">
                      {csatData.total_ratings}
                    </div>
                    <div className="stat-desc">Jumlah suara kepuasan terkumpul</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Rating Distribution Progress */}
                  <div className="card bg-base-100 shadow-sm border border-base-300">
                    <div className="card-body">
                      <h2 className="card-title text-lg mb-2">Distribusi Rating</h2>
                      <div className="space-y-3 mt-2">
                        {csatData.distribution.map((dist) => {
                          const percentage = csatData.total_ratings > 0 
                            ? Math.round((dist.count / csatData.total_ratings) * 100) 
                            : 0;
                          return (
                            <div key={dist.rating} className="flex items-center gap-3">
                              <span className="w-16 font-bold text-sm text-right flex items-center justify-end gap-1">
                                {dist.rating} <span className="text-warning">★</span>
                              </span>
                              <div className="flex-1">
                                <progress 
                                  className={`progress w-full ${dist.rating >= 4 ? 'progress-success' : dist.rating >= 3 ? 'progress-warning' : 'progress-error'}`} 
                                  value={percentage} 
                                  max="100"
                                ></progress>
                              </div>
                              <span className="w-16 text-right font-mono text-xs opacity-70">
                                {percentage}% ({dist.count})
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Leaderboard CSAT Agen */}
                  <div className="card bg-base-100 shadow-sm border border-base-300">
                    <div className="card-body">
                      <h2 className="card-title text-lg mb-2">Peringkat CSAT Agen</h2>
                      <div className="overflow-x-auto">
                        <table className="table table-zebra w-full table-sm">
                          <thead>
                            <tr>
                              <th>Nama Agen</th>
                              <th className="text-center">Skor CSAT</th>
                              <th className="text-right">Total Rating</th>
                            </tr>
                          </thead>
                          <tbody>
                            {csatData.agent_performance.length === 0 && (
                              <tr><td colSpan={3} className="text-center opacity-50">Belum ada penilaian untuk agen</td></tr>
                            )}
                            {csatData.agent_performance.map((agent, idx) => (
                              <tr key={idx}>
                                <td className="font-semibold flex items-center gap-2">
                                  <div className="avatar placeholder">
                                    <div className="bg-neutral text-neutral-content rounded-full w-6">
                                      <span className="text-[8px]">{agent.name.substring(0, 2).toUpperCase()}</span>
                                    </div>
                                  </div>
                                  {agent.name}
                                </td>
                                <td className="text-center font-bold text-warning font-mono">
                                  ⭐ {agent.avg_rating ? agent.avg_rating.toFixed(2) : '0.00'}
                                </td>
                                <td className="text-right font-mono opacity-70">{agent.total_ratings} suara</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Individual Feedback List */}
                <div className="card bg-base-100 shadow-sm border border-base-300">
                  <div className="card-body">
                    <h2 className="card-title text-lg mb-4">Umpan Balik Kepuasan Terbaru</h2>
                    
                    {loadingCsat ? (
                      <div className="flex justify-center py-6">
                        <span className="loading loading-spinner loading-md text-primary"></span>
                      </div>
                    ) : (
                      <>
                        <div className="overflow-x-auto">
                          <table className="table table-zebra table-sm w-full">
                            <thead>
                              <tr>
                                <th>Waktu</th>
                                <th>Pelanggan</th>
                                <th>Agen</th>
                                <th>Rating</th>
                                <th>Umpan Balik</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ratingsList.length === 0 && (
                                <tr>
                                  <td colSpan={5} className="text-center italic opacity-50 py-4">Belum ada umpan balik kepuasan masuk.</td>
                                </tr>
                              )}
                              {ratingsList.map((item) => (
                                <tr key={item.id}>
                                  <td className="font-mono text-xs">
                                    {new Date(item.created_at).toLocaleString('id-ID', {
                                      dateStyle: 'short',
                                      timeStyle: 'short'
                                    })}
                                  </td>
                                  <td className="font-semibold">{item.contact_name}</td>
                                  <td>{item.agent_name || <span className="opacity-50">-</span>}</td>
                                  <td>{renderStars(item.rating)}</td>
                                  <td className="max-w-xs truncate whitespace-normal break-words text-sm">
                                    {item.feedback || <span className="italic opacity-40">Hanya memberikan rating</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Pagination */}
                        {csatTotalPages > 1 && (
                          <div className="flex justify-between items-center mt-4">
                            <span className="text-xs opacity-75">Halaman {csatPage} dari {csatTotalPages}</span>
                            <div className="btn-group">
                              <button 
                                className="btn btn-xs btn-outline"
                                onClick={() => setCsatPage(p => Math.max(1, p - 1))}
                                disabled={csatPage === 1}
                              >
                                « Prev
                              </button>
                              <button 
                                className="btn btn-xs btn-outline"
                                onClick={() => setCsatPage(p => Math.min(csatTotalPages, p + 1))}
                                disabled={csatPage >= csatTotalPages}
                              >
                                Next »
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </>
        )}

      </div>
    </div>
  );
};

export default Analytics;