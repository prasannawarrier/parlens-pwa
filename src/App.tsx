import React, { useState } from 'react';
import { useAuth } from './contexts/AuthContext';
import { LandingPage } from './pages/LandingPage';
import { QRScanPage } from './pages/QRScanPage';
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
    <div className="min-h-screen bg-zinc-50 dark:bg-black p-6 text-zinc-900 dark:text-white text-center overflow-y-auto no-scrollbar flex flex-col items-center justify-center transition-colors duration-300" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
      <div className="w-full max-w-sm space-y-12 animate-in fade-in zoom-in-95 duration-700">
        <div className="space-y-4">
          <img
            src="/parlens-pwa/pwa-512x512.png"
            alt="Parlens"
            className="mx-auto h-24 w-24 rounded-[22%] shadow-2xl shadow-[#007AFF]/20"
          />
          <h1 className="text-5xl font-extrabold tracking-tighter text-zinc-900 dark:text-white">Parlens</h1>
          {/* UPDATED: User requested "Decentralized Route & Parking Management" */}
          <p className="text-sm font-medium text-zinc-500 dark:text-white/40 tracking-tight">Decentralized Route & Parking Management</p>
        </div>

        <div className="space-y-4">
          {view === 'landing' ? (
            <>
              <button
                onClick={handleCreateAccount}
                disabled={isLoading}
                className="w-full h-16 rounded-3xl bg-white dark:bg-white text-black font-bold text-lg shadow-xl shadow-black/5 dark:shadow-none active:scale-95 transition-all flex items-center justify-center gap-3 border border-black/5 dark:border-transparent"
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
                Login with Nostr Account
              </button>
            </>
          ) : view === 'setup' ? (
            <div className="space-y-4 pt-4 animate-in slide-in-from-right-4">
              <div className="text-center pb-2">
                <h3 className="text-xl font-bold text-zinc-900 dark:text-white">Pick a Username</h3>
                <p className="text-zinc-500 dark:text-white/40 text-sm">This will be your identity on Nostr</p>
              </div>
              <input
                type="text"
                placeholder="Username"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="w-full h-16 rounded-3xl bg-white dark:bg-zinc-900 border border-black/5 dark:border-white/10 px-6 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007AFF] placeholder:text-zinc-400 dark:placeholder:text-white/20 shadow-sm dark:shadow-none"
                autoFocus
              />
              <div className="flex gap-3">
                <button
                  onClick={() => setView('landing')}
                  className="h-16 px-6 rounded-3xl bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white border border-black/5 dark:border-white/10 font-bold shadow-sm dark:shadow-none"
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
                <h3 className="text-xl font-bold text-zinc-900 dark:text-white">🎉 Account Created!</h3>
                <p className="text-zinc-500 dark:text-white/40 text-sm mt-1">Backup your keys before continuing</p>
              </div>

              <div className="space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-400 dark:text-white/30 ml-2">Keys</h4>
                <div className="space-y-0.5 rounded-[2rem] overflow-hidden bg-white dark:bg-white/[0.03] border border-black/5 dark:border-white/10 shadow-sm dark:shadow-none">
                  <div
                    className="p-5 flex items-center justify-between transition-colors cursor-pointer active:bg-black/5 dark:active:bg-white/10"
                    onClick={() => {
                      if (generatedKeys) {
                        navigator.clipboard.writeText(generatedKeys.npub);
                        alert('Copied to clipboard');
                      }
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-blue-500/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400"><Key size={20} /></div>
                      <span className="font-semibold text-sm text-zinc-900 dark:text-white">Copy Nostr Public Key (Npub)</span>
                    </div>
                    <ChevronRight size={18} className="text-zinc-400 dark:text-white/20" />
                  </div>
                  <div className="h-[1px] bg-black/5 dark:bg-white/5 mx-4" />
                  <div
                    className="p-5 flex items-center justify-between transition-colors cursor-pointer active:bg-black/5 dark:active:bg-white/10"
                    onClick={() => {
                      if (generatedKeys) {
                        navigator.clipboard.writeText(generatedKeys.nsec);
                        alert('Copied to clipboard');
                      }
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-red-500/10 dark:bg-red-500/20 text-red-600 dark:text-red-500"><Shield size={20} /></div>
                      <span className="font-semibold text-sm text-zinc-900 dark:text-white">Copy Nostr Secret Key (Nsec)</span>
                    </div>
                    <ChevronRight size={18} className="text-zinc-400 dark:text-white/20" />
                  </div>
                </div>
                <p className="text-xs text-zinc-400 dark:text-white/30 mt-2 ml-2 leading-relaxed text-center">
                  ⚠️ Store your npub and nsec securely. These are your account access keys and cannot be recovered if lost.
                </p>
              </div>

              {/* Onboarding Help Content */}
              <div className="space-y-6 pt-6 border-t border-black/5 dark:border-white/10">
                <div className="space-y-2">
                  <h3 className="text-lg font-bold text-zinc-900 dark:text-white">Getting Started</h3>
                  <p className="text-sm text-zinc-500 dark:text-white/60">Follow these steps to get the most out of Parlens.</p>
                </div>

                {/* Add to Homescreen - Removed as per user request (redundant) */}

                <div className="space-y-4 text-sm text-zinc-600 dark:text-white/60 leading-relaxed">
                  <p>
                    <strong className="text-zinc-900 dark:text-white block mb-1">1. Select vehicle type</strong>
                    Use the vertical toggle on the bottom-left to switch between Bicycle 🚲, Motorcycle 🏍️, or Car 🚗.
                  </p>

                  <p>
                    <strong className="text-zinc-900 dark:text-white block mb-1">2. Plan your route (optional)</strong>
                    Tap the route button to add waypoints and create a route. If the system generated route(s) between your start and end points are not to your liking, add additional waypoints in locations you would prefer travelling through. Click the location button to re-centre and turn on follow-me or navigation mode for route tracking.
                  </p>

                  <p>
                    <strong className="text-zinc-900 dark:text-white block mb-1">3. Find and log parking</strong>
                    Click the main button once to see open spots in listed parking spaces and open spots reported by others live or within the last 5 minutes. For standard parking: Click again to mark your location. When leaving, click once more to end the session, log the fee and report the spot. For listed parking: Click the QR code scanner button below the vehicle type selector. Scan the QR code at the parking location to start the session. When leaving, scan it again to end the session and log the fee. Use the profile button to see your parking history.
                  </p>

                  <p>
                    <strong className="text-zinc-900 dark:text-white block mb-1">4. Create and manage a listed parking (optional)</strong>
                    Users who oversee one or more parking spots can create a listed parking to simplify spot and lot management. Click the parking services button (‽) at the bottom left-hand corner of the screen, and click the '+' button to create a listing. Provide the relevant details requested in the form to create an online listing that matches your real-world space. Listed parkings can be public (open to all users) or private (open to select users and only publish to select relays). Once created you can see your listings as viewed by other users in the public or private listing page. You should use the my listing page to manage your listing(s). Larger listings may take longer to create. You may manually refresh the page using the button provided next to the search bar if automatic updates are not returned fast enough.
                  </p>

                  <p>
                    <strong className="text-zinc-900 dark:text-white block mb-1">5. Create your own mirror (optional)</strong>
                    <a
                      href="https://github.com/prasannawarrier/parlens-pwa/blob/main/MIRROR_CREATION.md"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 dark:text-blue-400 underline"
                    >
                      Follow these steps
                    </a> to create your own mirror of the Parlens app to distribute the bandwidth load while sharing with your friends.
                  </p>

                  <p>
                    <strong className="text-zinc-900 dark:text-white block mb-1">6. User privacy</strong>
                    Parlens does not collect or share any user data. Your log and route data is encrypted by your keys, only accessible by you and stored on relays of your preference. Open spot broadcasts and listed parking log updates use temporary identifiers to prevent your permanent public key from being shared.
                  </p>

                  {/* Tip */}
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 mt-4">
                    <p className="text-xs text-amber-700 dark:text-amber-500/90 leading-relaxed">
                      <span className="font-bold">Tip: </span>
                      Use Parlens over your cellular internet connection to prevent personal IP address(es) from being associated with your data.
                    </p>
                  </div>
                </div>
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
                className="w-full h-16 rounded-3xl bg-white dark:bg-zinc-900 border border-black/5 dark:border-white/10 px-6 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007AFF] placeholder:text-zinc-400 dark:placeholder:text-white/20 shadow-sm dark:shadow-none"
                autoFocus
              />
              <div className="flex gap-3">
                <button
                  onClick={() => setView('landing')}
                  className="h-16 px-6 rounded-3xl bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white border border-black/5 dark:border-white/10 font-bold shadow-sm dark:shadow-none"
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
            <div className="p-4 rounded-3xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-500 text-xs font-bold text-center animate-in fade-in slide-in-from-top-2">
              {error}
            </div>
          )}

          {/* Add to Homescreen Section */}
          <div className="space-y-3 pt-6 border-t border-black/5 dark:border-white/10">
            <h3 className="text-center font-bold text-zinc-500 dark:text-white/70 text-sm">Add to your homescreen for fullscreen experience</h3>
            {/* Android */}
            <div className="rounded-2xl bg-white dark:bg-white/5 overflow-hidden shadow-sm dark:shadow-none border border-black/5 dark:border-transparent">
              <button onClick={() => {
                const el = document.getElementById('login-android-guide');
                el?.classList.toggle('hidden');
              }} className="w-full flex items-center justify-between p-4 font-bold text-sm text-left text-zinc-800 dark:text-white/80 transition-colors" style={{ WebkitTapHighlightColor: 'transparent' }}>
                <span>Using Browser Menu (Android)</span>
                <ChevronDown size={16} className="text-zinc-400 dark:text-white/50" />
              </button>
              <div id="login-android-guide" className="hidden p-4 pt-0 text-xs text-zinc-600 dark:text-white/60 space-y-2 text-left">
                <p className="font-semibold text-zinc-900 dark:text-white/80">Chrome & Brave:</p>
                <ol className="list-decimal pl-5 space-y-1">
                  <li>Tap menu button (three dots)</li>
                  <li>Tap <strong>Add to Home screen</strong></li>
                  <li>Tap <strong>Add</strong> to confirm</li>
                </ol>
                <p className="font-semibold text-zinc-900 dark:text-white/80 mt-3">Firefox:</p>
                <ol className="list-decimal pl-5 space-y-1">
                  <li>Tap menu button (three dots)</li>
                  <li>Tap <strong>Install</strong></li>
                </ol>
              </div>
            </div>

            {/* iOS */}
            <div className="rounded-2xl bg-white dark:bg-white/5 overflow-hidden shadow-sm dark:shadow-none border border-black/5 dark:border-transparent">
              <button onClick={() => {
                const el = document.getElementById('login-ios-guide');
                el?.classList.toggle('hidden');
              }} className="w-full flex items-center justify-between p-4 font-bold text-sm text-left text-zinc-800 dark:text-white/80 transition-colors" style={{ WebkitTapHighlightColor: 'transparent' }}>
                <span>Using Share Button (iOS)</span>
                <ChevronDown size={16} className="text-zinc-400 dark:text-white/50" />
              </button>
              <div id="login-ios-guide" className="hidden p-4 pt-0 text-xs text-zinc-600 dark:text-white/60 space-y-2 text-left">
                <ol className="list-decimal pl-5 space-y-1">
                  <li>Tap the <strong className="text-zinc-900 dark:text-white/80">Share</strong> button in Safari menu bar.</li>
                  <li>Scroll down and tap <strong className="text-zinc-900 dark:text-white/80">Add to Home Screen</strong>.</li>
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
  const [currentPage, setCurrentPage] = useState<'home' | 'scan'>('home');
  const [pendingScanCode, setPendingScanCode] = useState<string | null>(null);

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

  // QR Scan Page
  if (currentPage === 'scan') {
    return (
      <QRScanPage
        onCancel={() => setCurrentPage('home')}
        onScan={(code) => {
          setPendingScanCode(code);
          setCurrentPage('home');
        }}
      />
    );
  }

  // Landing Page (Home)
  return (
    <LandingPage
      onRequestScan={() => setCurrentPage('scan')}
      initialScannedCode={pendingScanCode}
      onScannedCodeConsumed={() => setPendingScanCode(null)}
    />
  );
};

export default App;
