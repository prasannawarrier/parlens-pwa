import React, { useState, useEffect } from 'react';
import { Key, X, Shield, ChevronRight, MapPin, Clock, ClipboardList } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useParkingLogs } from '../hooks/useParkingLogs';
import { nip19 } from 'nostr-tools';
import { decryptParkingLog } from '../lib/encryption';
import { getCurrencySymbol } from '../lib/currency';

export const ProfileButton: React.FC = () => {
    const { pubkey, logout } = useAuth();
    const { logs, refetch } = useParkingLogs();
    const [isOpen, setIsOpen] = useState(false);
    const [profile, setProfile] = useState<any>(null);
    const [decryptedLogs, setDecryptedLogs] = useState<any[]>([]);

    useEffect(() => {
        if (pubkey) {
            setProfile({
                name: 'Nostr User',
                npub: nip19.npubEncode(pubkey),
                picture: `https://api.dicebear.com/7.x/bottts/svg?seed=${pubkey}`
            });
        }
    }, [pubkey]);

    useEffect(() => {
        const fetchDecrypted = async () => {
            if (!pubkey || !logs.length) return;

            const privkeyHex = localStorage.getItem('parlens_privkey');
            const seckey = privkeyHex ? new Uint8Array(privkeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))) : undefined;

            const decrypted = await Promise.all(logs.map(async (log) => {
                try {
                    const content = await decryptParkingLog(log.content, pubkey, seckey);
                    return { ...log, decryptedContent: content };
                } catch (e) {
                    return { ...log, decryptedContent: null };
                }
            }));

            setDecryptedLogs(decrypted.filter(l => l.decryptedContent));
        };
        fetchDecrypted();
    }, [logs, pubkey]);

    return (
        <>
            <button
                onClick={() => { refetch(); setIsOpen(true); }}
                className="h-12 w-12 flex items-center justify-center rounded-2xl bg-white/10 backdrop-blur-md text-white/70 hover:bg-white/20 active:scale-95 transition-all shadow-lg"
                title="Activity Log"
            >
                <ClipboardList size={20} />
            </button>

            {isOpen && (
                <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/60 backdrop-blur-md p-6 animate-in fade-in duration-300">
                    <div className="w-full max-w-md bg-zinc-900 rounded-[2.5rem] shadow-2xl border border-white/10 flex flex-col overflow-hidden max-h-[85vh] animate-in zoom-in-95">
                        <div className="flex items-center justify-between p-8 border-b border-white/5">
                            <h2 className="text-3xl font-bold tracking-tight">Account</h2>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="h-10 w-10 flex items-center justify-center rounded-full bg-white/5 text-white/60 hover:text-white"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto px-8 pb-10 space-y-8 scrollbar-hide">
                            <div className="flex items-center gap-6 p-6 mt-4">
                                <div className="h-20 w-20 rounded-full bg-white/10 overflow-hidden ring-4 ring-white/5">
                                    <img src={profile?.picture} alt="User" className="h-full w-full" />
                                </div>
                                <div className="space-y-1">
                                    <h3 className="text-2xl font-bold">{profile?.name}</h3>
                                    <p className="text-[11px] font-medium text-white/40 tracking-wider truncate max-w-[180px]">
                                        {profile?.npub}
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <h4 className="text-xs font-bold uppercase tracking-widest text-white/20 ml-2">Keys</h4>
                                <div className="space-y-0.5 rounded-[2rem] overflow-hidden bg-white/[0.03]">
                                    <div className="p-5 flex items-center justify-between hover:bg-white/5 transition-colors cursor-pointer" onClick={() => {
                                        navigator.clipboard.writeText(profile?.npub);
                                        alert('Public key copied');
                                    }}>
                                        <div className="flex items-center gap-4">
                                            <div className="p-2.5 rounded-xl bg-blue-500/20 text-blue-400"><Key size={20} /></div>
                                            <span className="font-semibold text-sm">Copy Public Key</span>
                                        </div>
                                        <ChevronRight size={18} className="text-white/20" />
                                    </div>
                                    {localStorage.getItem('parlens_privkey') && (
                                        <>
                                            <div className="border-t border-white/5" />
                                            <div className="p-5 flex items-center justify-between hover:bg-white/5 transition-colors cursor-pointer" onClick={() => {
                                                const priv = localStorage.getItem('parlens_privkey');
                                                if (priv) {
                                                    const nsec = nip19.nsecEncode(new Uint8Array(priv.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))));
                                                    navigator.clipboard.writeText(nsec);
                                                    alert('Secret key copied to clipboard');
                                                }
                                            }}>
                                                <div className="flex items-center gap-4">
                                                    <div className="p-2.5 rounded-xl bg-red-500/20 text-red-400"><Shield size={20} /></div>
                                                    <span className="font-semibold text-sm">Backup Secret Key</span>
                                                </div>
                                                <ChevronRight size={18} className="text-white/20" />
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-4">
                                <h4 className="text-xs font-bold uppercase tracking-widest text-white/20 ml-2">Parking History</h4>
                                <div className="space-y-2">
                                    {decryptedLogs.length > 0 ? (
                                        decryptedLogs.map((log) => {
                                            const content = log.decryptedContent;
                                            const currencySymbol = getCurrencySymbol(content.currency || 'USD');
                                            const startTime = content.started_at ? new Date(content.started_at * 1000) : null;
                                            const endTime = content.finished_at ? new Date(content.finished_at * 1000) : new Date(log.created_at * 1000);
                                            const coords = content.lat && content.lon ? `${content.lat.toFixed(5)}, ${content.lon.toFixed(5)}` : null;

                                            return (
                                                <div key={log.id} className="p-5 rounded-3xl bg-white/[0.03] space-y-3">
                                                    <div className="flex items-center justify-between">
                                                        <p className="font-bold text-xl">{content.fee ? `${currencySymbol}${content.fee}` : 'Free Parking'}</p>
                                                        <span className="text-[10px] font-medium text-white/20 px-2 py-1 rounded-full bg-white/5">{content.currency || 'USD'}</span>
                                                    </div>

                                                    {coords && (
                                                        <div className="flex items-center gap-2 text-xs text-white/40">
                                                            <MapPin size={12} className="text-blue-400" />
                                                            <span className="font-mono">{coords}</span>
                                                        </div>
                                                    )}

                                                    <div className="flex items-center gap-2 text-xs text-white/30">
                                                        <Clock size={12} className="text-green-400" />
                                                        <div className="space-x-1">
                                                            {startTime && (
                                                                <span>Start: {startTime.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} {startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                            )}
                                                            <span className="text-white/10">→</span>
                                                            <span>End: {endTime.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} {endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    ) : (
                                        <div className="p-10 rounded-[2.5rem] border-2 border-dashed border-white/5 text-center">
                                            <p className="text-sm font-medium text-white/10">No recent activity</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <button
                                onClick={() => { logout(); setIsOpen(false); }}
                                className="w-full py-5 rounded-[2rem] bg-zinc-800 text-red-500 font-bold tracking-wide border border-white/5 hover:bg-zinc-700 transition-all active:scale-95 text-center mt-4"
                            >
                                Logout Session
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
