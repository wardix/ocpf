import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { useToastStore } from '../store/toastStore';

interface ExportJob {
  id: number;
  export_type: string;
  export_format: string;
  status: string;
  file_size_bytes: string | null;
  row_count: number | null;
  progress_percent: number;
  expires_at: string | null;
  created_at: string;
}

const ReportsDashboard = () => {
  const { token, user } = useAuthStore();
  const { addToast } = useToastStore();
  
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  
  const [exportType, setExportType] = useState('conversations');
  const [exportFormat, setExportFormat] = useState('csv');

  const fetchJobs = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/exports`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const result = await response.json();
      if (response.ok && result.success) {
        setJobs(result.data);
      }
    } catch (err) {
      console.error('Failed to fetch exports', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();

    const handleWebSocketEvent = (e: any) => {
      const payload = e.detail;
      if (['export.started', 'export.progress', 'export.completed', 'export.failed'].includes(payload.type)) {
        // Optimistically update or refetch
        fetchJobs();
        if (payload.type === 'export.completed') {
          addToast('Export berhasil diselesaikan', 'success');
        } else if (payload.type === 'export.failed') {
          addToast('Export gagal', 'error');
        }
      }
    };

    window.addEventListener('chatEvent', handleWebSocketEvent);
    return () => window.removeEventListener('chatEvent', handleWebSocketEvent);
  }, [token]);

  const handleExport = async () => {
    if (!token) return;
    setIsExporting(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/exports`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          export_type: exportType,
          export_format: exportFormat
        })
      });
      const result = await response.json();
      if (response.ok && result.success) {
        addToast('Proses export berjalan di latar belakang', 'success');
        fetchJobs();
      } else {
        addToast(result.error || 'Gagal memulai export', 'error');
      }
    } catch (err) {
      addToast('Terjadi kesalahan jaringan', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownload = (id: number) => {
    if (!token) return;
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    // Using window.open allows the browser to handle the download, but we need auth token.
    // Instead, fetch blob and save.
    fetch(`${apiUrl}/api/exports/${id}/download`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => {
        if (!res.ok) throw new Error('File tidak dapat diunduh');
        const disposition = res.headers.get('Content-Disposition');
        let filename = 'export.file';
        if (disposition && disposition.indexOf('filename=') !== -1) {
          const match = disposition.match(/filename="?([^"]+)"?/);
          if (match && match[1]) filename = match[1];
        }
        return res.blob().then(blob => ({ blob, filename }));
      })
      .then(({ blob, filename }) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      })
      .catch(err => {
        addToast(err.message || 'Gagal mengunduh file', 'error');
      });
  };

  const formatSize = (bytes: string | null) => {
    if (!bytes) return '-';
    const b = parseInt(bytes, 10);
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024 * 1024)).toFixed(2) + ' MB';
  };

  if (user?.role !== 'administrator') {
    return <div className="p-8 text-center opacity-50">Hanya administrator yang dapat mengakses laporan.</div>;
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-base-200 overflow-y-auto">
      <div className="bg-base-100 border-b border-base-300 p-4 sticky top-0 z-10">
        <h1 className="text-2xl font-bold">📊 Laporan & Ekspor Data</h1>
        <p className="text-sm opacity-70">Unduh data historis secara asinkron tanpa membebani server.</p>
      </div>

      <div className="p-6 max-w-5xl mx-auto w-full space-y-6">
        
        <div className="card bg-base-100 shadow-sm border border-base-300">
          <div className="card-body">
            <h2 className="card-title text-lg mb-4">Mulai Ekspor Baru</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="form-control w-full">
                <label className="label font-semibold"><span className="label-text">Tipe Data</span></label>
                <select className="select select-bordered" value={exportType} onChange={e => setExportType(e.target.value)}>
                  <option value="conversations">Data Percakapan (Conversations)</option>
                  <option value="contacts">Data Kontak (Contacts)</option>
                </select>
              </div>

              <div className="form-control w-full">
                <label className="label font-semibold"><span className="label-text">Format File</span></label>
                <select className="select select-bordered" value={exportFormat} onChange={e => setExportFormat(e.target.value)}>
                  <option value="csv">CSV (Sangat Ringan, cocok untuk data besar)</option>
                  <option value="xlsx">Excel (XLSX) (Mudah dibaca manusia)</option>
                </select>
              </div>
            </div>

            <div className="card-actions justify-end mt-4">
              <button className={`btn btn-primary ${isExporting ? 'loading' : ''}`} onClick={handleExport} disabled={isExporting}>
                Mulai Ekspor Data
              </button>
            </div>
          </div>
        </div>

        <div className="card bg-base-100 shadow-sm border border-base-300">
          <div className="card-body">
            <div className="flex justify-between items-center mb-4">
              <h2 className="card-title text-lg">Riwayat Ekspor (Background Jobs)</h2>
              <button className="btn btn-sm btn-ghost btn-square" onClick={fetchJobs} title="Refresh">🔄</button>
            </div>
            
            <div className="overflow-x-auto">
              <table className="table table-zebra w-full">
                <thead>
                  <tr>
                    <th>Waktu Ekspor</th>
                    <th>Tipe Data</th>
                    <th>Status / Progress</th>
                    <th>Detail</th>
                    <th className="text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={5} className="text-center py-8"><span className="loading loading-spinner"></span></td></tr>
                  ) : jobs.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-8 opacity-50">Belum ada riwayat ekspor</td></tr>
                  ) : (
                    jobs.map(job => (
                      <tr key={job.id}>
                        <td className="text-sm">
                          {new Date(job.created_at).toLocaleString('id-ID')}
                        </td>
                        <td>
                          <div className="font-bold uppercase text-xs">{job.export_format}</div>
                          <div className="text-sm opacity-80">{job.export_type === 'conversations' ? 'Percakapan' : 'Kontak'}</div>
                        </td>
                        <td>
                          {job.status === 'completed' && <span className="badge badge-success badge-sm">Selesai</span>}
                          {job.status === 'failed' && <span className="badge badge-error badge-sm">Gagal</span>}
                          {job.status === 'expired' && <span className="badge badge-neutral badge-sm">Kadaluarsa</span>}
                          {job.status === 'queued' && <span className="badge badge-ghost badge-sm">Antre</span>}
                          {job.status === 'processing' && (
                            <div className="w-full">
                              <div className="flex justify-between text-xs mb-1">
                                <span>Memproses...</span>
                                <span>{job.progress_percent}%</span>
                              </div>
                              <progress className="progress progress-primary w-24" value={job.progress_percent} max="100"></progress>
                            </div>
                          )}
                        </td>
                        <td className="text-xs">
                          {job.status === 'completed' ? (
                            <>
                              <div>Baris: {job.row_count}</div>
                              <div>Ukuran: {formatSize(job.file_size_bytes)}</div>
                            </>
                          ) : '-'}
                        </td>
                        <td className="text-right">
                          <button 
                            className="btn btn-sm btn-outline" 
                            disabled={job.status !== 'completed'}
                            onClick={() => handleDownload(job.id)}
                          >
                            Download
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
};

export default ReportsDashboard;
