import React, { useState, useEffect } from 'react';
import { Key, X, Shield, ChevronRight, MapPin, Clock, User, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useParkingLogs } from '../hooks/useParkingLogs';
import { nip19 } from 'nostr-tools';
import { decryptParkingLog } from '../lib/encryption';
import { getCurrencySymbol, getCountryFlag } from '../lib/currency';
import { DEFAULT_RELAYS, KINDS } from '../lib/nostr';

interface ProfileButtonProps {
    setHistorySpots?: (spots: any[]) => void;
    onOpenChange?: (isOpen: boolean) => void;
}

export const ProfileButton: React.FC<ProfileButtonProps> = ({ setHistorySpots, onOpenChange }) => {
    const { pubkey, logout, pool, signEvent } = useAuth();
    const { logs, refetch } = useParkingLogs();
    const [isOpen, setIsOpen] = useState(false);
    const [profile, setProfile] = useState<any>(null);
    const [decryptedLogs, setDecryptedLogs] = useState<any[]>([]);
    const [showHistoryOnMap, setShowHistoryOnMap] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        if (pubkey) {
            const fetchProfile = async () => {
                const event = await pool.get(DEFAULT_RELAYS, {
                    kinds: [0],
                    authors: [pubkey]
                });

                if (event) {
                    try {
                        const content = JSON.parse(event.content);
                        setProfile({
                            name: content.name || content.display_name || 'Nostr User',
                            npub: nip19.npubEncode(pubkey),
                            picture: content.picture
                        });
                    } catch (e) {
                        console.error('Error parsing profile:', e);
                    }
                } else {
                    setProfile({
                        name: 'Nostr User',
                        npub: nip19.npubEncode(pubkey),
                        picture: `https://api.dicebear.com/7.x/bottts/svg?seed=${pubkey}`
                    });
                }
            };
            fetchProfile();
        }
    }, [pubkey, pool]);

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

    // Lift history state to parent when toggle changes or logs update
    useEffect(() => {
        if (setHistorySpots) {
            if (showHistoryOnMap) {
                setHistorySpots(decryptedLogs);
            } else {
                setHistorySpots([]);
            }
        }
    }, [showHistoryOnMap, decryptedLogs, setHistorySpots]);

    const handleBackupKey = () => {
        const priv = localStorage.getItem('parlens_privkey');
        if (priv) {
            const nsec = nip19.nsecEncode(new Uint8Array(priv.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))));
            navigator.clipboard.writeText(nsec);
            alert('Copied to clipboard');
        }
    };

    // Delete a parking log using NIP-09 (kind 5 deletion event)
    const handleDeleteLog = async (log: any) => {
        if (!confirm('Are you sure you want to delete this parking entry? This action cannot be undone.')) {
            return;
        }

        setIsDeleting(true);
        try {
            // Get the 'd' tag value from the log for addressable event deletion
            const dTag = log.tags?.find((t: string[]) => t[0] === 'd')?.[1];

            const deleteEvent = {
                kind: 5, // NIP-09 deletion event
                content: 'Deleted by user',
                tags: [
                    ['e', log.id], // Reference the event ID
                    ...(dTag ? [['a', `${KINDS.PARKING_LOG}:${pubkey}:${dTag}`]] : []) // Reference addressable event
                ],
                created_at: Math.floor(Date.now() / 1000),
                pubkey: pubkey!,
            };

            const signedDelete = await signEvent(deleteEvent);
            await Promise.allSettled(pool.publish(DEFAULT_RELAYS, signedDelete));

            // Remove from local state
            setDecryptedLogs(prev => prev.filter(l => l.id !== log.id));

            // Refetch to update
            refetch();

            alert('Entry deleted');
        } catch (e) {
            console.error('Delete error:', e);
            alert('Failed to delete entry');
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <>
            <button
                onClick={() => { refetch(); setIsOpen(true); onOpenChange?.(true); }}
                className="h-12 w-12 flex items-center justify-center rounded-[1.5rem] bg-white/80 dark:bg-white/10 backdrop-blur-md text-zinc-600 dark:text-white/70 hover:bg-white dark:hover:bg-white/20 active:scale-95 transition-all shadow-lg border border-black/5 dark:border-white/10"
                title="Profile"
            >
                <User size={20} />
            </button>

            {isOpen && (
                <div className="fixed inset-0 z-[2000] flex flex-col items-center justify-start bg-black/60 backdrop-blur-xl animate-in fade-in duration-300 pt-2 px-4 pb-4">
                    <button
                        onClick={() => { setIsOpen(false); onOpenChange?.(false); }}
                        className="absolute inset-0 z-0 cursor-default"
                    />

                    <div className="relative z-10 w-full max-w-md bg-white dark:bg-[#1c1c1e] rounded-[2rem] shadow-2xl p-6 flex flex-col gap-6 animate-in slide-in-from-bottom-10 duration-300 h-[calc(100vh-1.5rem)] overflow-y-auto no-scrollbar border border-black/5 dark:border-white/5 transition-colors">

                        {/* Loading Overlay */}
                        {isDeleting && (
                            <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/70 backdrop-blur-sm">
                                <div className="flex flex-col items-center gap-3">
                                    <div className="w-8 h-8 rounded-full border-4 border-white/20 border-t-white animate-spin" />
                                    <p className="text-sm font-medium text-white">Deleting...</p>
                                </div>
                            </div>
                        )}
                        {/* Header - Username Only */}
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-bold bg-gradient-to-r from-blue-500 to-purple-500 dark:from-blue-400 dark:to-purple-400 bg-clip-text text-transparent">
                                {profile?.name || 'Nostr User'}
                            </h2>
                            <button
                                onClick={() => { setIsOpen(false); onOpenChange?.(false); }}
                                className="p-2 rounded-full bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 transition-colors"
                            >
                                <X size={20} className="text-black/60 dark:text-white/60" />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-400 dark:text-white/20 ml-2">Keys</h4>
                            <div className="space-y-0.5 rounded-[2rem] overflow-hidden bg-zinc-50 dark:bg-white/[0.03] border border-black/5 dark:border-white/5">
                                <div className="p-5 flex items-center justify-between hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer" onClick={() => {
                                    navigator.clipboard.writeText(profile?.npub);
                                    alert('Copied to clipboard');
                                }}>
                                    <div className="flex items-center gap-3">
                                        <div className="p-2.5 rounded-xl bg-blue-500/10 dark:bg-blue-500/20 text-blue-500 dark:text-blue-400"><Key size={20} /></div>
                                        <span className="font-semibold text-sm text-zinc-700 dark:text-white">Copy Nostr Public Key (Npub)</span>
                                    </div>
                                    <ChevronRight size={18} className="text-zinc-400 dark:text-white/20" />
                                </div>
                                {localStorage.getItem('parlens_privkey') && (
                                    <>
                                        <div className="h-[1px] bg-black/5 dark:bg-white/5 mx-4" />
                                        <div
                                            onClick={handleBackupKey}
                                            className="flex items-center justify-between p-4 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors active:bg-black/10 dark:active:bg-white/10"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="p-2.5 rounded-xl bg-red-500/10 dark:bg-red-500/20 text-red-500"><Shield size={20} /></div>
                                                <span className="font-semibold text-sm text-zinc-700 dark:text-white">Copy Nostr Secret Key (Nsec)</span>
                                            </div>
                                            <ChevronRight size={18} className="text-zinc-400 dark:text-white/20" />
                                        </div>
                                    </>
                                )}
                            </div>
                            <p className="text-xs text-zinc-400 dark:text-white/30 mt-2 ml-2 leading-relaxed">
                                ⚠️ Store your npub and nsec securely. These are your account access keys and cannot be recovered if lost.
                            </p>
                        </div>


                        <div className="space-y-4">
                            <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-400 dark:text-white/20 ml-2">Parking History</h4>

                            {setHistorySpots && (
                                <div className="flex items-center justify-between p-4 bg-zinc-50 dark:bg-white/5 rounded-[2rem] border border-black/5 dark:border-white/5 mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2.5 rounded-xl bg-purple-500/10 dark:bg-purple-500/20 text-purple-500 dark:text-purple-400"><MapPin size={20} /></div>
                                        <span className="font-semibold text-sm text-zinc-700 dark:text-white">Show logs on map</span>
                                    </div>
                                    <button
                                        onClick={() => setShowHistoryOnMap(!showHistoryOnMap)}
                                        className={`w-12 h-7 rounded-full transition-colors relative ${showHistoryOnMap ? 'bg-blue-500' : 'bg-zinc-200 dark:bg-white/20'}`}
                                    >
                                        <div className={`absolute top-1 bottom-1 w-5 h-5 rounded-full bg-white transition-transform ${showHistoryOnMap ? 'left-[calc(100%-1.25rem-0.25rem)]' : 'left-1'}`} />
                                    </button>
                                </div>
                            )}

                            <div className="space-y-2">
                                {decryptedLogs.length > 0 ? (
                                    decryptedLogs.map((log) => {
                                        const content = log.decryptedContent;
                                        const currencySymbol = getCurrencySymbol(content.currency || 'USD');
                                        const startTime = content.started_at ? new Date(content.started_at * 1000) : null;
                                        const endTime = content.finished_at ? new Date(content.finished_at * 1000) : new Date(log.created_at * 1000);
                                        const coords = content.lat && content.lon ? `${content.lat.toFixed(5)}, ${content.lon.toFixed(5)}` : null;

                                        // Read type from encrypted content (privacy) with fallback to tags for backward compatibility
                                        const type = content.type || log.tags?.find((t: string[]) => t[0] === 'type')?.[1] || 'car';
                                        const typeEmoji = type === 'bicycle' ? '🚲' : type === 'motorcycle' ? '🏍️' : '🚗';

                                        return (
                                            <div key={log.id} className="p-5 rounded-[2rem] bg-zinc-50 dark:bg-white/[0.03] space-y-3 border border-black/5 dark:border-white/5 text-zinc-900 dark:text-white">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-2xl">{typeEmoji}</span>
                                                        <p className="font-bold text-xl">{content.fee ? `${currencySymbol}${content.fee}` : 'Free'}</p>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-2xl">{getCountryFlag(content.currency || 'USD')}</span>
                                                        <button
                                                            onClick={() => handleDeleteLog(log)}
                                                            className="p-2 rounded-xl text-zinc-400 dark:text-white/40 active:scale-95 transition-transform"
                                                            title="Delete entry"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                </div>

                                                {coords && (
                                                    <div className="flex items-center gap-2 text-xs text-zinc-400 dark:text-white/40">
                                                        <MapPin size={12} className="text-blue-500 dark:text-blue-400" />
                                                        <span className="font-mono">{coords}</span>
                                                    </div>
                                                )}

                                                <div className="flex items-center gap-2 text-xs text-zinc-400 dark:text-white/30">
                                                    <Clock size={12} className="text-green-500 dark:text-green-400" />
                                                    <div className="space-x-1">
                                                        {startTime && (
                                                            <span>Start: {startTime.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} {startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                        )}
                                                        <span className="text-black/10 dark:text-white/10">→</span>
                                                        <span>End: {endTime.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} {endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <div className="p-10 rounded-[2.5rem] border-2 border-dashed border-black/5 dark:border-white/5 text-center">
                                        <p className="text-sm font-medium text-zinc-400 dark:text-white/10">No recent activity</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        <button
                            onClick={() => { logout(); setIsOpen(false); onOpenChange?.(false); }}
                            className="w-full py-5 rounded-[2rem] bg-zinc-100 dark:bg-zinc-800 text-red-500 font-bold tracking-wide border border-black/5 dark:border-white/5 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all active:scale-95 text-center mt-4"
                        >
                            Logout
                        </button>
                    </div>
                </div>
            )}
        </>
    );
};
