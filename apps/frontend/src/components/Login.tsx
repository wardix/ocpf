import React, { useState } from 'react';

interface Props {
  onLoginSuccess: (token: string, user: any) => void;
}

const Login = ({ onLoginSuccess }: Props) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        onLoginSuccess(data.token, data.user);
      } else {
        setError(data.error || 'Login gagal. Periksa kembali email dan password Anda.');
      }
    } catch (err) {
      setError('Terjadi kesalahan jaringan.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-screen bg-base-200 items-center justify-center font-sans">
      <div className="card w-96 bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title justify-center text-2xl mb-4">🔐 Agen Login</h2>
          
          {error && (
            <div className="alert alert-error text-sm p-2 rounded-md mb-4">
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div className="form-control w-full">
              <label className="label"><span className="label-text">Email</span></label>
              <input 
                type="email" 
                placeholder="admin@omnichannel.local" 
                className="input input-bordered w-full" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="form-control w-full">
              <label className="label"><span className="label-text">Password</span></label>
              <input 
                type="password" 
                placeholder="••••••••" 
                className="input input-bordered w-full" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="card-actions justify-end mt-4">
              <button 
                type="submit" 
                className={`btn btn-primary w-full text-white ${loading ? 'loading' : ''}`}
                disabled={loading}
              >
                {loading ? 'Masuk...' : 'Masuk Dashboard'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Login;