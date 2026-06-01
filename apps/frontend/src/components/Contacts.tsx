import React, { useState, useEffect } from 'react';

import { useAuthStore } from '../store/authStore';

interface Contact {
  id: number;
  name: string;
  phone_number: string;
  email: string | null;
  created_at: string;
  total_tickets: number;
}

interface Props {
  onStartChat: (phone: string) => void;
}

const Contacts = ({ onStartChat }: Props) => {
  const { token } = useAuthStore();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    const fetchContacts = async () => {
      if (!token) return;
      setIsLoading(true);
      try {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
        const response = await fetch(`${apiUrl}/api/contacts?q=${encodeURIComponent(search)}&page=${page}&per_page=25`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
          const result = await response.json();
          setContacts(result.data);
          setTotalPages(Math.ceil(result.meta.total / result.meta.per_page));
        }
      } catch (err) {
        console.error('Gagal mengambil kontak:', err);
      } finally {
        setIsLoading(false);
      }
    };

    // Debounce pencarian
    const timeoutId = setTimeout(() => {
      fetchContacts();
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [token, search, page]);

  // Reset page ke 1 jika melakukan pencarian
  useEffect(() => {
    setPage(1);
  }, [search]);

  return (
    <div className="flex-1 flex flex-col bg-base-200/50 h-full p-8 overflow-y-auto">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold">Buku Telepon (CRM)</h1>
          <p className="text-base-content/60 mt-2">Kelola daftar pelanggan yang pernah menghubungi layanan Anda.</p>
        </div>
        <div className="form-control">
          <div className="input-group">
            <input 
              type="text" 
              placeholder="Cari nama atau nomor HP..." 
              className="input input-bordered w-80 shadow-sm" 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="bg-base-100 rounded-2xl shadow-sm border border-base-300 overflow-hidden flex-1 flex flex-col">
        <div className="overflow-x-auto">
          <table className="table w-full">
            <thead>
              <tr className="bg-base-200/50">
                <th className="w-16">ID</th>
                <th>Nama Pelanggan</th>
                <th>Nomor WhatsApp</th>
                <th>Email</th>
                <th>Terdaftar Sejak</th>
                <th className="text-center">Total Tiket</th>
                <th className="text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, idx) => (
                  <tr key={`skeleton-${idx}`}>
                    <td><div className="skeleton h-4 w-6"></div></td>
                    <td>
                      <div className="flex items-center space-x-3">
                        <div className="skeleton w-8 h-8 rounded-full"></div>
                        <div className="skeleton h-4 w-32"></div>
                      </div>
                    </td>
                    <td><div className="skeleton h-4 w-24"></div></td>
                    <td><div className="skeleton h-4 w-32"></div></td>
                    <td><div className="skeleton h-4 w-24"></div></td>
                    <td className="text-center"><div className="skeleton h-4 w-6 mx-auto"></div></td>
                    <td className="text-right"><div className="skeleton h-6 w-16 ml-auto"></div></td>
                  </tr>
                ))
              ) : contacts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-16">
                    <div className="flex flex-col items-center justify-center opacity-40">
                      <span className="text-6xl mb-4">👥</span>
                      <p className="font-bold text-lg">Tidak Ada Kontak</p>
                      <p className="text-sm">Belum ada pelanggan yang tersimpan di sistem.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                contacts.map((c) => (
                  <tr key={c.id} className="hover">
                    <td className="font-mono text-xs opacity-50">#{c.id}</td>
                    <td>
                      <div className="flex items-center space-x-3">
                        <div className="avatar placeholder">
                          <div className="bg-neutral text-neutral-content rounded-full w-8">
                            <span className="text-xs">{c.name.substring(0, 2).toUpperCase()}</span>
                          </div>
                        </div>
                        <div className="font-bold">{c.name}</div>
                      </div>
                    </td>
                    <td className="font-mono text-primary text-sm">{c.phone_number}</td>
                    <td className="text-sm opacity-70">{c.email || '-'}</td>
                    <td className="text-sm">{new Date(c.created_at).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
                    <td className="text-center">
                      <div className="badge badge-ghost">{c.total_tickets}</div>
                    </td>
                    <td className="text-right">
                      <button 
                        className="btn btn-xs btn-primary btn-outline"
                        onClick={() => onStartChat(c.phone_number)}
                      >
                        💬 Chat
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-base-200 bg-base-100 flex justify-between items-center">
          <span className="text-sm opacity-70">Halaman {page} dari {totalPages || 1}</span>
          <div className="btn-group">
            <button 
              className="btn btn-sm btn-outline" 
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              « Prev
            </button>
            <button 
              className="btn btn-sm btn-outline" 
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next »
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Contacts;