import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';

interface AnalyticsData {
  today: {
    incoming_tickets: number;
    resolved_tickets: number;
  };
  current_status: { status: string; count: string }[];
  agent_performance: { name: string; resolved_count: string }[];
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
  const { token } = useAuthStore();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Tab State
  const [activeTab, setActiveTab] = useState<'general' | 'csat'>('general');

  // CSAT States
  const [csatData, setCsatData] = useState<CSATAnalytics | null>(null);
  const [ratingsList, setRatingsList] = useState<CSATRatingItem[]>([]);
  const [csatPage, setCsatPage] = useState(1);
  const [csatTotalPages, setCsatTotalPages] = useState(1);
  const [loadingCsat, setLoadingCsat] = useState(false);

  const fetchAnalytics = async () => {
    if (!token) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/analytics`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const result = await response.json();
      
      if (response.ok && result.success) {
        setData(result.data);
      } else {
        setErrorMsg(result.error || 'Gagal memuat data dari server');
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
      const response = await fetch(`${apiUrl}/api/analytics/csat`, {
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
      const response = await fetch(`${apiUrl}/api/analytics/csat/ratings?page=${page}&per_page=10`, {
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
    fetchAnalytics();
  }, [token]);

  useEffect(() => {
    if (activeTab === 'csat' && token) {
      fetchCSATAnalytics();
      fetchCSATRatingsList(csatPage);
    }
  }, [token, activeTab, csatPage]);

  const handleManualRefresh = () => {
    if (activeTab === 'general') {
      fetchAnalytics();
    } else {
      fetchCSATAnalytics();
      fetchCSATRatingsList(csatPage);
    }
  };

  const renderStars = (rating: number) => {
    return (
      <div className="flex gap-0.5 text-warning text-sm">
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} className="text-base">
            {i < rating ? '★' : '☆'}
          </span>
        ))}
      </div>
    );
  };

  if (loading && !data && activeTab === 'general') {
    return (
      <div className="flex-1 flex items-center justify-center bg-base-200">
        <span className="loading loading-spinner loading-lg text-primary"></span>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-base-200">
        <span className="text-4xl mb-4">⚠️</span>
        <h2 className="text-xl font-bold text-error">{errorMsg}</h2>
        <button className="btn btn-outline btn-sm mt-4" onClick={handleManualRefresh}>Coba Lagi</button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-base-200 h-full overflow-y-auto p-8">
      <div className="max-w-5xl w-full mx-auto space-y-6">
        
        <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4">
          <div>
            <h1 className="text-3xl font-bold">📊 Dasbor Analitik</h1>
            <p className="text-base-content/60 mt-1">Pantau performa tim, volume pesan, dan kepuasan pelanggan.</p>
          </div>
          <div className="flex gap-2 self-start md:self-end">
            <div className="tabs tabs-boxed bg-base-100 border border-base-300">
              <button 
                className={`tab tab-sm ${activeTab === 'general' ? 'tab-active font-semibold' : ''}`}
                onClick={() => setActiveTab('general')}
              >
                📈 Umum
              </button>
              <button 
                className={`tab tab-sm ${activeTab === 'csat' ? 'tab-active font-semibold' : ''}`}
                onClick={() => setActiveTab('csat')}
              >
                ⭐ CSAT
              </button>
            </div>
            <button 
              className={`btn btn-sm btn-outline btn-primary ${loading || loadingCsat ? 'loading' : ''}`}
              onClick={handleManualRefresh}
              disabled={loading || loadingCsat}
            >
              🔄 Refresh
            </button>
          </div>
        </div>

        {/* Tab 1: General Analytics */}
        {activeTab === 'general' && data && (
          <>
            {/* Stats Row */}
            <div className="stats shadow w-full border border-base-300">
              <div className="stat">
                <div className="stat-figure text-primary">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="inline-block w-8 h-8 stroke-current"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>
                </div>
                <div className="stat-title">Tiket Masuk Hari Ini</div>
                <div className="stat-value text-primary">{data.today.incoming_tickets}</div>
                <div className="stat-desc">Percakapan dimulai oleh pelanggan</div>
              </div>
              
              <div className="stat">
                <div className="stat-figure text-success">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="inline-block w-8 h-8 stroke-current"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"></path></svg>
                </div>
                <div className="stat-title">Diselesaikan Hari Ini</div>
                <div className="stat-value text-success">{data.today.resolved_tickets}</div>
                <div className="stat-desc">Tiket yang ditutup oleh agen</div>
              </div>
              
              <div className="stat">
                <div className="stat-title">Penyelesaian Harian</div>
                <div className="stat-value">
                  {data.today.incoming_tickets > 0 
                    ? Math.round((data.today.resolved_tickets / data.today.incoming_tickets) * 100) 
                    : 0}%
                </div>
                <div className="stat-desc">Rasio tiket ditutup vs masuk</div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Status Tiket */}
              <div className="card bg-base-100 shadow-sm border border-base-300">
                <div className="card-body">
                  <h2 className="card-title text-lg mb-2">Distribusi Status Tiket</h2>
                  <div className="overflow-x-auto">
                    <table className="table table-zebra w-full table-sm">
                      <thead>
                        <tr>
                          <th>Status</th>
                          <th className="text-right">Jumlah</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.current_status.length === 0 && (
                          <tr><td colSpan={2} className="text-center opacity-50">Belum ada data</td></tr>
                        )}
                        {data.current_status.map((item, idx) => (
                          <tr key={idx}>
                            <td className="font-semibold capitalize">{item.status}</td>
                            <td className="text-right font-mono">{item.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Leaderboard Agen */}
              <div className="card bg-base-100 shadow-sm border border-base-300">
                <div className="card-body">
                  <h2 className="card-title text-lg mb-2">Performa Agen (Hari Ini)</h2>
                  <div className="overflow-x-auto">
                    <table className="table table-zebra w-full table-sm">
                      <thead>
                        <tr>
                          <th>Nama Agen</th>
                          <th className="text-right">Tiket Selesai</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.agent_performance.length === 0 && (
                          <tr><td colSpan={2} className="text-center opacity-50">Belum ada tiket diselesaikan hari ini</td></tr>
                        )}
                        {data.agent_performance.map((agent, idx) => (
                          <tr key={idx}>
                            <td className="font-semibold flex items-center gap-2">
                              <div className="avatar placeholder">
                                <div className="bg-neutral text-neutral-content rounded-full w-6">
                                  <span className="text-[8px]">{agent.name.substring(0, 2).toUpperCase()}</span>
                                </div>
                              </div>
                              {agent.name}
                            </td>
                            <td className="text-right font-mono text-success font-bold">+{agent.resolved_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Tab 2: CSAT Analytics */}
        {activeTab === 'csat' && csatData && (
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

      </div>
    </div>
  );
};

export default Analytics;