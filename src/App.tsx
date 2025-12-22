import React, { useState, useEffect } from 'react';
import { useAuth } from './contexts/AuthContext';
import { LandingPage } from './pages/LandingPage';
import { ShieldCheck, UserPlus, Key } from 'lucide-react';

const Login: React.FC = () => {
  const { login } = useAuth();
  const [nsec, setNsec] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [view, setView] = useState<'landing' | 'nsec'>('landing');

  // Request location permission early so it's ready when user logs in
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        () => console.log('Location permission granted'),
        (err) => console.log('Location permission status:', err.message),
        { enableHighAccuracy: true, timeout: 5000 }
      );
    }
  }, []);

  const handleLogin = async (method: 'extension' | 'nsec' | 'create') => {
    setIsLoading(true);
    setError('');
    try {
      await login(method, method === 'nsec' ? nsec : undefined);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-black p-6 text-white text-center">
      <div className="w-full max-w-sm space-y-12 animate-in fade-in zoom-in-95 duration-700">
        <div className="space-y-4">
          <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-[2.5rem] bg-blue-500 shadow-2xl shadow-blue-500/20">
            <span className="text-5xl font-black text-white">P</span>
          </div>
          <h1 className="text-5xl font-extrabold tracking-tighter">Parlens</h1>
          <p className="text-sm font-medium text-white/40 tracking-tight">Peer-to-Peer Parking Management</p>
        </div>

        <div className="space-y-4">
          {view === 'landing' ? (
            <>
              <button
                onClick={() => handleLogin('create')}
                disabled={isLoading}
                className="w-full h-16 rounded-3xl bg-white text-black font-bold text-lg shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3"
              >
                {isLoading ? 'Creating...' : (
                  <>
                    <UserPlus size={20} strokeWidth={3} />
                    Get Started
                  </>
                )}
              </button>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setView('nsec')}
                  disabled={isLoading}
                  className="h-16 rounded-3xl bg-blue-500 text-white font-bold shadow-lg shadow-blue-500/20 active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                  <Key size={18} />
                  Secret Key
                </button>
                <button
                  onClick={() => handleLogin('extension')}
                  disabled={isLoading}
                  className="h-16 rounded-3xl bg-zinc-900 border border-white/10 text-white font-bold active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                  <ShieldCheck size={18} className="text-blue-400" />
                  Browser
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-4 pt-4 animate-in slide-in-from-bottom-4">
              <input
                type="password"
                placeholder="Paste your nsec..."
                value={nsec}
                onChange={(e) => setNsec(e.target.value)}
                className="w-full h-16 rounded-3xl bg-zinc-900 border border-white/10 px-6 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-white/20"
                autoFocus
              />
              <div className="flex gap-3">
                <button
                  onClick={() => setView('landing')}
                  className="h-16 px-6 rounded-3xl bg-zinc-900 text-white font-bold"
                >
                  Back
                </button>
                <button
                  onClick={() => handleLogin('nsec')}
                  disabled={isLoading || !nsec}
                  className="flex-1 h-16 rounded-3xl bg-blue-500 text-white font-bold shadow-lg active:scale-95 transition-all"
                >
                  {isLoading ? 'Decrypting...' : 'Login with Key'}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-3xl bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-bold text-center animate-in fade-in slide-in-from-top-2">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const { pubkey } = useAuth();

  if (!pubkey) {
    return <Login />;
  }

  return <LandingPage />;
};

export default App;
