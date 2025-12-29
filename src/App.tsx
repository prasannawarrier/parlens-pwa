import React, { useState } from 'react';
import { useAuth } from './contexts/AuthContext';
import { LandingPage } from './pages/LandingPage';
import { Shield, UserPlus, Key, ChevronDown, ChevronRight } from 'lucide-react';
import { nip19 } from 'nostr-tools';

const Login: React.FC = () => {
  const { login } = useAuth();
  const [nsec, setNsec] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [view, setView] = useState<'landing' | 'nsec' | 'setup' | 'backup'>('landing');
  const [newUsername, setNewUsername] = useState('');
  const [generatedKeys, setGeneratedKeys] = useState<{ npub: string; nsec: string } | null>(null);

  const handleLogin = async (method: 'extension' | 'nsec') => {
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

  const handleCreateAccount = () => {
    setView('setup');
  };

  const handleFinishSetup = async () => {
    if (!newUsername.trim()) {
      setError('Please enter a username');
      return;
    }
    setIsLoading(true);
    try {
      // Import here to avoid top-level import issues
      const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');

      // Convert bytes to hex string
      const toHex = (bytes: Uint8Array) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

      // Generate keys
      const privateKey = generateSecretKey();
      const publicKey = getPublicKey(privateKey);

      // Store keys
      localStorage.setItem('parlens_privkey', toHex(privateKey));
      localStorage.setItem('parlens_pubkey', publicKey);
      localStorage.setItem('parlens_pending_username', newUsername);

      // Generate bech32 encoded keys for display
      const npubKey = nip19.npubEncode(publicKey);
      const nsecKey = nip19.nsecEncode(privateKey);

      setGeneratedKeys({ npub: npubKey, nsec: nsecKey });
      setView('backup');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCompleteSetup = async () => {
    setIsLoading(true);
    try {
      const pendingUsername = localStorage.getItem('parlens_pending_username');
      await login('create', undefined, pendingUsername || newUsername);
      localStorage.removeItem('parlens_pending_username');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black p-6 text-white text-center overflow-y-auto no-scrollbar flex flex-col items-center justify-center" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
      <div className="w-full max-w-sm space-y-12 animate-in fade-in zoom-in-95 duration-700">
        <div className="space-y-4">
          <img
            src="/parlens-pwa/pwa-512x512.png"
            alt="Parlens"
            className="mx-auto h-24 w-24 rounded-[22%] shadow-2xl shadow-[#007AFF]/20"
          />
          <h1 className="text-5xl font-extrabold tracking-tighter">Parlens</h1>
          {/* UPDATED: User requested "Decentralized Route & Parking Management" */}
          <p className="text-sm font-medium text-white/40 tracking-tight">Decentralized Route & Parking Management</p>
        </div>

        <div className="space-y-4">
          {view === 'landing' ? (
            <>
              <button
                onClick={handleCreateAccount}
                disabled={isLoading}
                className="w-full h-16 rounded-3xl bg-white text-black font-bold text-lg shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3"
              >
                {isLoading ? 'Creating...' : (
                  <>
                    <UserPlus size={20} strokeWidth={3} />
                    Create a New Account
                  </>
                )}
              </button>

              <button
                onClick={() => setView('nsec')}
                disabled={isLoading}
                className="w-full h-16 rounded-3xl bg-[#007AFF] text-white font-bold text-lg shadow-lg shadow-[#007AFF]/20 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <Key size={18} />
                Login with Secret Key
              </button>
            </>
          ) : view === 'setup' ? (
            <div className="space-y-4 pt-4 animate-in slide-in-from-right-4">
              <div className="text-center pb-2">
                <h3 className="text-xl font-bold">Pick a Username</h3>
                <p className="text-white/40 text-sm">This will be your identity on Nostr</p>
              </div>
              <input
                type="text"
                placeholder="Username"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="w-full h-16 rounded-3xl bg-zinc-900 border border-white/10 px-6 text-white focus:outline-none focus:ring-2 focus:ring-[#007AFF] placeholder:text-white/20"
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
                  onClick={handleFinishSetup}
                  disabled={isLoading || !newUsername}
                  className="flex-1 h-16 rounded-3xl bg-[#007AFF] text-white font-bold shadow-lg active:scale-95 transition-all"
                >
                  {isLoading ? 'Creating...' : 'Continue'}
                </button>
              </div>
            </div>
          ) : view === 'backup' ? (
            <div className="space-y-6 pt-4 animate-in slide-in-from-right-4 text-left">
              <div className="text-center pb-2">
                <h3 className="text-xl font-bold">🎉 Account Created!</h3>
                <p className="text-white/40 text-sm mt-1">Back up your keys before continuing</p>
              </div>

              <div className="space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-widest text-white/30 ml-2">Your Keys</h4>
                <div className="space-y-0.5 rounded-[2rem] overflow-hidden bg-white/[0.03] border border-white/10">
                  <div
                    className="p-5 flex items-center justify-between hover:bg-white/5 transition-colors cursor-pointer active:bg-white/10"
                    onClick={() => {
                      if (generatedKeys) {
                        navigator.clipboard.writeText(generatedKeys.npub);
                        alert('Public Key copied to clipboard');
                      }
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-blue-500/20 text-blue-400"><Key size={20} /></div>
                      <span className="font-semibold text-sm text-white">Copy Public Key (Npub)</span>
                    </div>
                    <ChevronRight size={18} className="text-white/20" />
                  </div>
                  <div className="h-[1px] bg-white/5 mx-4" />
                  <div
                    className="p-5 flex items-center justify-between hover:bg-white/5 transition-colors cursor-pointer active:bg-white/10"
                    onClick={() => {
                      if (generatedKeys) {
                        navigator.clipboard.writeText(generatedKeys.nsec);
                        alert('Secret Key copied to clipboard - keep this safe!');
                      }
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-red-500/20 text-red-500"><Shield size={20} /></div>
                      <span className="font-semibold text-sm text-white">Copy Secret Key (Nsec)</span>
                    </div>
                    <ChevronRight size={18} className="text-white/20" />
                  </div>
                </div>
                <p className="text-xs text-white/30 mt-2 ml-2 leading-relaxed text-center">
                  ⚠️ Store these keys securely. They cannot be recovered if lost.
                </p>
              </div>

              <button
                onClick={handleCompleteSetup}
                disabled={isLoading}
                className="w-full h-16 rounded-3xl bg-[#007AFF] text-white font-bold shadow-lg shadow-[#007AFF]/20 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                {isLoading ? 'Starting...' : 'Start Using Parlens'}
              </button>
            </div>
          ) : (
            <div className="space-y-4 pt-4 animate-in slide-in-from-bottom-4">
              <input
                type="password"
                placeholder="Paste your nsec..."
                value={nsec}
                onChange={(e) => setNsec(e.target.value)}
                className="w-full h-16 rounded-3xl bg-zinc-900 border border-white/10 px-6 text-white focus:outline-none focus:ring-2 focus:ring-[#007AFF] placeholder:text-white/20"
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
                  className="flex-1 h-16 rounded-3xl bg-[#007AFF] text-white font-bold shadow-lg active:scale-95 transition-all"
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

          {/* Add to Homescreen Section */}
          <div className="space-y-3 pt-6 border-t border-white/10">
            <h3 className="text-center font-bold text-white/70 text-sm">Add to your homescreen for fullscreen experience</h3>
            {/* Android */}
            <div className="rounded-2xl bg-white/5 overflow-hidden">
              <button onClick={() => {
                const el = document.getElementById('login-android-guide');
                el?.classList.toggle('hidden');
              }} className="w-full flex items-center justify-between p-4 font-bold text-sm text-left hover:bg-white/5 text-white/80 transition-colors" style={{ WebkitTapHighlightColor: 'transparent' }}>
                <span>Using Browser Menu (Android)</span>
                <ChevronDown size={16} className="text-white/50" />
              </button>
              <div id="login-android-guide" className="hidden p-4 pt-0 text-xs text-white/60 space-y-2 text-left">
                <p className="font-semibold text-white/80">Chrome & Brave:</p>
                <ol className="list-decimal pl-5 space-y-1">
                  <li>Tap menu button (three dots)</li>
                  <li>Tap <strong>Add to Home screen</strong></li>
                  <li>Tap <strong>Add</strong> to confirm</li>
                </ol>
                <p className="font-semibold text-white/80 mt-3">Firefox:</p>
                <ol className="list-decimal pl-5 space-y-1">
                  <li>Tap menu button (three dots)</li>
                  <li>Tap <strong>Install</strong></li>
                </ol>
              </div>
            </div>

            {/* iOS */}
            <div className="rounded-2xl bg-white/5 overflow-hidden">
              <button onClick={() => {
                const el = document.getElementById('login-ios-guide');
                el?.classList.toggle('hidden');
              }} className="w-full flex items-center justify-between p-4 font-bold text-sm text-left hover:bg-white/5 text-white/80 transition-colors" style={{ WebkitTapHighlightColor: 'transparent' }}>
                <span>Using Share Button (iOS)</span>
                <ChevronDown size={16} className="text-white/50" />
              </button>
              <div id="login-ios-guide" className="hidden p-4 pt-0 text-xs text-white/60 space-y-2 text-left">
                <ol className="list-decimal pl-5 space-y-1">
                  <li>Tap the <strong className="text-white/80">Share</strong> button in Safari menu bar.</li>
                  <li>Scroll down and tap <strong className="text-white/80">Add to Home Screen</strong>.</li>
                  <li>Launch Parlens from your home screen.</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const { pubkey } = useAuth();

  // Global visibility change handler for iOS PWA background suspension
  React.useEffect(() => {
    let lastHiddenTime = 0;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        lastHiddenTime = Date.now();
        console.log('[App] Backgrounded at', new Date().toISOString());
      } else if (document.visibilityState === 'visible' && lastHiddenTime > 0) {
        const hiddenDuration = Date.now() - lastHiddenTime;
        console.log('[App] Foregrounded after', hiddenDuration, 'ms');

        // If backgrounded for more than 5 seconds, trigger global refresh
        if (hiddenDuration > 5000) {
          console.log('[App] Dispatching visibility-refresh event');
          window.dispatchEvent(new Event('visibility-refresh'));
        }
      }
    };

    // Handle iOS bfcache restoration
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        console.log('[App] Page restored from bfcache, triggering refresh');
        window.dispatchEvent(new Event('visibility-refresh'));
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, []);

  if (!pubkey) {
    return <Login />;
  }

  return <LandingPage />;
};

export default App;
