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

const Analytics = () => {
  const { token } = useAuthStore();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
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

    fetchAnalytics();
  }, [token]);

  const handleManualRefresh = () => {
    if (!token) return;
    setLoading(true);
    setErrorMsg(null);
    setTimeout(() => {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      fetch(`${apiUrl}/api/analytics`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      .then(res => res.json())
      .then(result => {
        if (result.success) setData(result.data);
        else setErrorMsg(result.error || 'Gagal memuat data dari server');
      })
      .catch(err => {
        console.error(err);
        setErrorMsg('Terjadi kesalahan jaringan.');
      })
      .finally(() => setLoading(false));
    }, 500);
  };

  if (loading && !data) {
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

  if (!data) return null;

  return (
    <div className="flex-1 flex flex-col bg-base-200 h-full overflow-y-auto p-8">
      <div className="max-w-5xl w-full mx-auto space-y-6">
        
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-bold">📊 Dasbor Analitik</h1>
            <p className="text-base-content/60 mt-1">Pantau performa tim dan volume pesan.</p>
          </div>
          <button 
            className={`btn btn-sm btn-outline btn-primary ${loading ? 'loading' : ''}`}
            onClick={handleManualRefresh}
            disabled={loading}
          >
            🔄 Refresh Data
          </button>
        </div>

        {/* Stats Row */}
        <div className="stats shadow w-full">
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
                <table className="table table-zebra w-full">
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
                <table className="table table-zebra w-full">
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

      </div>
    </div>
  );
};

export default Analytics;