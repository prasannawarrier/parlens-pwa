import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Key, X, Shield, ChevronRight, MapPin, Clock, User, Trash2, Plus, Radio, Pencil, Check, EyeOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useParkingLogs } from '../hooks/useParkingLogs';
import { nip19 } from 'nostr-tools';
import { decryptParkingLog, encryptParkingLog } from '../lib/encryption';
import { getCurrencySymbol, getCountryFlag } from '../lib/currency';
import { DEFAULT_RELAYS, KINDS } from '../lib/nostr';

interface ProfileButtonProps {
    setHistorySpots?: (spots: any[]) => void;
    onOpenChange?: (isOpen: boolean) => void;
    onHelpClick?: () => void;
}

export const ProfileButton: React.FC<ProfileButtonProps> = ({ setHistorySpots, onOpenChange, onHelpClick }) => {
    const { pubkey, logout, pool, signEvent } = useAuth();
    const { logs, refetch, markDeleted } = useParkingLogs();
    const [isOpen, setIsOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    // Preferred Relays state
    const [preferredRelays, setPreferredRelays] = useState<string[]>([]);
    const [showPreferredRelays, setShowPreferredRelays] = useState(false);
    const [isAddingRelay, setIsAddingRelay] = useState(false);
    const [newRelayUrl, setNewRelayUrl] = useState('');
    const [isRelayLoading, setIsRelayLoading] = useState(false);
    const [relayError, setRelayError] = useState<string | null>(null);

    // Hidden Items state (unified structure for hidden listings and owners)
    interface HiddenItem {
        id: string;
        name: string;
        type: 'listing' | 'owner';
    }
    const [hiddenItems, setHiddenItems] = useState<HiddenItem[]>([]);
    const [showHideList, setShowHideList] = useState(false);

    useEffect(() => {
        if (isOpen) {
            try {
                const saved = localStorage.getItem('parlens-hidden-items');
                if (saved) {
                    setHiddenItems(JSON.parse(saved));
                }
            } catch (e) { }
        }
    }, [isOpen]);

    const unhideItem = (id: string) => {
        const next = hiddenItems.filter(h => h.id !== id);
        setHiddenItems(next);
        localStorage.setItem('parlens-hidden-items', JSON.stringify(next));
    };

    // Notify parent when open state changes
    useEffect(() => {
        onOpenChange?.(isOpen);
    }, [isOpen, onOpenChange]);
    const [profile, setProfile] = useState<any>(null);
    const [decryptedLogs, setDecryptedLogs] = useState<any[]>([]);
    const [showHistoryOnMap, setShowHistoryOnMap] = useState(false);

    // Parking History filters
    const [filterType, setFilterType] = useState<'all' | 'bicycle' | 'motorcycle' | 'car'>('all');

    // Note editing state
    const [editingNoteLogId, setEditingNoteLogId] = useState<string | null>(null);
    const [editingNoteValue, setEditingNoteValue] = useState('');
    const [isSavingNote, setIsSavingNote] = useState(false);

    // Handle delete parking log using NIP-09
    const handleDeleteLog = async (log: any) => {
        if (!pubkey || !confirm('Are you sure you want to delete this parking entry? This action cannot be undone.')) return;

        setIsDeleting(true);
        try {
            // Get the 'd' tag value for the addressable event reference
            const dTag = log.tags?.find((t: string[]) => t[0] === 'd')?.[1];
            if (!dTag) {
                throw new Error('Missing d tag on event');
            }

            // NIP-09: Kind 5 deletion event with 'a' tag for addressable events
            // Format: ['a', '<kind>:<pubkey>:<d-identifier>']
            const deleteEvent = {
                kind: 5, // NIP-09 deletion event
                content: 'Deleted by user',
                tags: [
                    ['a', `${KINDS.PARKING_LOG}:${pubkey}:${dTag}`],
                    ['k', String(KINDS.PARKING_LOG)] // Optional: specify kind being deleted
                ],
                created_at: Math.floor(Date.now() / 1000),
                pubkey: pubkey,
            };

            const signedDelete = await signEvent(deleteEvent);
            await Promise.allSettled(pool.publish(DEFAULT_RELAYS, signedDelete));

            // Mark as deleted locally so it won't reappear after refetch
            markDeleted(dTag);

            // Remove from local state immediately
            setDecryptedLogs(prev => prev.filter(l => l.id !== log.id));
        } catch (e) {
            console.error('Failed to delete parking log:', e);
            alert('Failed to delete. Please try again.');
        } finally {
            setIsDeleting(false);
        }
    };

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

    // Format duration from start to end
    const formatDuration = (startTime: Date | null, endTime: Date): string => {
        if (!startTime) return 'Unknown';
        const diffMs = endTime.getTime() - startTime.getTime();
        const diffMins = Math.floor(diffMs / (1000 * 60));
        if (diffMins < 60) return `${diffMins}m`;
        const hours = Math.floor(diffMins / 60);
        const mins = diffMins % 60;
        return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    };

    // Update note on a parking log
    const handleUpdateNote = async (log: any, newNote: string) => {
        if (!pubkey || !signEvent) return;

        setIsSavingNote(true);
        try {
            const dTag = log.tags?.find((t: string[]) => t[0] === 'd')?.[1];
            if (!dTag) throw new Error('Missing d tag');

            // Get seckey for encryption
            const privkeyHex = localStorage.getItem('parlens_privkey');
            const seckey = privkeyHex ? new Uint8Array(privkeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))) : undefined;

            // Update content with new note
            const updatedContent = { ...log.decryptedContent, note: newNote };
            const encrypted = await encryptParkingLog(updatedContent, pubkey, seckey);

            const event = {
                kind: KINDS.PARKING_LOG,
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                    ['d', dTag],
                    ['client', 'parlens'],
                ],
                content: encrypted,
            };

            const signedEvent = await signEvent(event);
            await Promise.allSettled(pool.publish(DEFAULT_RELAYS, signedEvent));

            // Update local state
            setDecryptedLogs(prev => prev.map(l =>
                l.id === log.id ? { ...l, decryptedContent: updatedContent } : l
            ));
            setEditingNoteLogId(null);
            setEditingNoteValue('');
        } catch (e) {
            console.error('Failed to update note:', e);
            alert('Failed to save note');
        } finally {
            setIsSavingNote(false);
        }
    };

    // Filter logs by type and date
    const filteredLogs = useMemo(() => {
        return decryptedLogs.filter(log => {
            const content = log.decryptedContent;
            const type = content.type || 'car';

            // Type filter
            if (filterType !== 'all' && type !== filterType) return false;

            return true;
        });
    }, [decryptedLogs, filterType]);

    // Fetch preferred relays (NIP-65)
    const fetchPreferredRelays = useCallback(async () => {
        if (!pool || !pubkey) return;

        setIsRelayLoading(true);
        try {
            const event = await pool.get(DEFAULT_RELAYS, {
                kinds: [KINDS.RELAY_LIST],
                authors: [pubkey],
            });

            if (event) {
                // Extract relay URLs from 'r' tags
                const relays = event.tags
                    .filter((t: string[]) => t[0] === 'r')
                    .map((t: string[]) => t[1]);
                setPreferredRelays(relays);
            } else {
                // No NIP-65 event found, use default relays
                setPreferredRelays([...DEFAULT_RELAYS]);
            }
        } catch (error) {
            console.error('Error fetching preferred relays:', error);
            // Fallback to default relays on error
            setPreferredRelays([...DEFAULT_RELAYS]);
        } finally {
            setIsRelayLoading(false);
        }
    }, [pool, pubkey]);

    // Publish updated relay list
    const publishRelayList = async (relays: string[]) => {
        if (!pool || !pubkey || !signEvent) return;

        const event = {
            kind: KINDS.RELAY_LIST,
            created_at: Math.floor(Date.now() / 1000),
            tags: relays.map(url => ['r', url]),
            content: '',
        };

        const signedEvent = await signEvent(event);
        await Promise.allSettled(pool.publish(DEFAULT_RELAYS, signedEvent));
        setPreferredRelays(relays);
    };

    // Add a new relay
    const handleAddRelay = async () => {
        const url = newRelayUrl.trim();
        setRelayError(null);

        // Validate URL format
        if (!url.startsWith('wss://')) {
            setRelayError('Relay URL must start with wss://');
            return;
        }

        // Check for duplicates
        if (preferredRelays.includes(url)) {
            setRelayError('This relay is already in your list');
            return;
        }

        setIsRelayLoading(true);
        try {
            await publishRelayList([...preferredRelays, url]);
            setNewRelayUrl('');
            setIsAddingRelay(false);
        } catch (error) {
            console.error('Error adding relay:', error);
            setRelayError('Failed to add relay');
        } finally {
            setIsRelayLoading(false);
        }
    };

    // Remove a relay (with confirmation like route delete)
    const handleRemoveRelay = async (url: string) => {
        if (!confirm(`Are you sure you want to remove this relay?\n\n${url}\n\nThis action cannot be undone.`)) return;

        setIsRelayLoading(true);
        try {
            await publishRelayList(preferredRelays.filter(r => r !== url));
        } catch (error) {
            console.error('Error removing relay:', error);
            alert('Failed to remove relay');
        } finally {
            setIsRelayLoading(false);
        }
    };

    // Fetch preferred relays when modal opens
    useEffect(() => {
        if (isOpen && pubkey) {
            fetchPreferredRelays();
        }
    }, [isOpen, pubkey, fetchPreferredRelays]);

    return (
        <>
            <button
                onClick={() => { refetch(); setIsOpen(true); }}
                className="h-12 w-12 flex items-center justify-center rounded-[1.5rem] bg-white/80 dark:bg-white/10 backdrop-blur-md text-zinc-600 dark:text-white/70 active:scale-95 transition-all shadow-lg border border-black/5 dark:border-white/10"
                title="Activity Log"
            >
                <User size={20} />
            </button>

            {isOpen && (
                <div className="fixed inset-0 z-[2000] flex flex-col items-center justify-start bg-black/60 backdrop-blur-xl animate-in fade-in duration-300 pt-2 px-4 pb-4">
                    <button
                        onClick={() => setIsOpen(false)}
                        className="absolute inset-0 z-0 cursor-default"
                    />

                    {/* Deleting Overlay - positioned outside modal to cover border */}
                    {isDeleting && (
                        <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/70 backdrop-blur-sm">
                            <div className="flex flex-col items-center gap-3">
                                <div className="w-8 h-8 rounded-full border-4 border-white/20 border-t-white animate-spin" />
                                <p className="text-sm font-medium text-white">Deleting...</p>
                            </div>
                        </div>
                    )}

                    <div className="relative z-10 w-full max-w-md bg-white dark:bg-[#1c1c1e] rounded-[2rem] shadow-2xl p-6 flex flex-col gap-6 animate-in slide-in-from-bottom-10 duration-300 h-[calc(100vh-1.5rem)] overflow-y-auto no-scrollbar border border-black/5 dark:border-white/5 transition-colors">

                        {/* Header - Username Only */}
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-bold bg-gradient-to-r from-blue-500 to-purple-500 dark:from-blue-400 dark:to-purple-400 bg-clip-text text-transparent">
                                {profile?.name || 'Nostr User'}
                            </h2>
                            <div className="flex gap-4 items-center">
                                <button
                                    onClick={() => onHelpClick?.()} // Don't close profile
                                    className="w-10 h-10 flex items-center justify-center rounded-full bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 active:scale-95 transition-all"
                                >
                                    <span className="text-xl font-bold">?</span>
                                </button>
                                <button
                                    onClick={() => setIsOpen(false)}
                                    className="p-2 rounded-full bg-black/5 dark:bg-white/10 text-zinc-600 dark:text-white/60 active:scale-95 transition-transform"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-400 dark:text-white/20 ml-2">Keys</h4>
                            <div className="space-y-0.5 rounded-[2rem] overflow-hidden bg-zinc-50 dark:bg-white/[0.03] border border-black/5 dark:border-white/5">
                                <div className="p-5 flex items-center justify-between transition-colors cursor-pointer" onClick={() => {
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
                                            className="flex items-center justify-between p-4 cursor-pointer transition-colors active:bg-black/10 dark:active:bg-white/10"
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
                                ⚠️ Store your npub and nsec securely. These are your account access keys and cannot be recovered if lost. Use these keys to login to any Nostr client.
                            </p>
                        </div>

                        {/* Preferred Relays Section */}
                        <div className="space-y-4">
                            <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-400 dark:text-white/20 ml-2">Preferred Relays</h4>
                            <div className="space-y-0.5 rounded-[2rem] overflow-hidden bg-zinc-50 dark:bg-white/[0.03] border border-black/5 dark:border-white/5">
                                <button
                                    onClick={() => setShowPreferredRelays(!showPreferredRelays)}
                                    className="w-full p-5 flex items-center justify-between transition-colors"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="p-2.5 rounded-xl bg-green-500/10 dark:bg-green-500/20 text-green-500 dark:text-green-400"><Radio size={20} /></div>
                                        <span className="font-semibold text-sm text-zinc-700 dark:text-white">Manage Relays ({preferredRelays.length})</span>
                                    </div>
                                    <span className="text-xs text-zinc-400 dark:text-white/40">
                                        {showPreferredRelays ? 'Hide' : 'Show'}
                                    </span>
                                </button>

                                {showPreferredRelays && (
                                    <>
                                        <div className="h-[1px] bg-black/5 dark:bg-white/5 mx-4" />
                                        <div className="p-4 space-y-2">
                                            {isRelayLoading && preferredRelays.length === 0 ? (
                                                <div className="text-center text-zinc-400 dark:text-white/40 text-sm py-4">
                                                    Loading...
                                                </div>
                                            ) : (
                                                <>
                                                    {preferredRelays.map((relay) => (
                                                        <div
                                                            key={relay}
                                                            className="flex items-center justify-between p-3 rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10"
                                                        >
                                                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                                                <Radio size={16} className="text-green-500 shrink-0" />
                                                                <span className="text-sm text-zinc-700 dark:text-white truncate">
                                                                    {relay.replace('wss://', '')}
                                                                </span>
                                                            </div>
                                                            <button
                                                                onClick={() => handleRemoveRelay(relay)}
                                                                disabled={preferredRelays.length <= 1} // Enforce at least one relay
                                                                className="p-2 rounded-lg text-zinc-400 dark:text-white/40 active:scale-95 transition-transform disabled:opacity-30 disabled:cursor-not-allowed"
                                                                title={preferredRelays.length <= 1 ? 'At least one relay is required' : 'Remove relay'}
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    ))}
                                                    <button
                                                        onClick={() => {
                                                            setIsAddingRelay(true);
                                                            setRelayError(null);
                                                            setNewRelayUrl('');
                                                        }}
                                                        className="w-full p-3 flex items-center justify-center gap-2 rounded-xl bg-blue-500/10 dark:bg-blue-500/20 border border-blue-500/20 transition-colors active:scale-[0.98]"
                                                    >
                                                        <Plus size={16} className="text-blue-500" />
                                                        <span className="text-sm font-medium text-blue-600 dark:text-blue-400">Add Relay</span>
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                            <p className="text-xs text-zinc-400 dark:text-white/30 mt-2 ml-2 leading-relaxed">
                                📡 Relay address(es) listed in this section tell Parlens where to look for and store data. Parlens requires a connection to at least one relay to work.
                            </p>
                            {/* Add Relay Modal */}
                            {isAddingRelay && (
                                <div
                                    className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/70 backdrop-blur-sm"
                                    onClick={() => setIsAddingRelay(false)}
                                >
                                    <div
                                        className="w-[90%] max-w-sm bg-white dark:bg-[#2c2c2e] rounded-2xl p-5 space-y-4 animate-in zoom-in-95 duration-200"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <h3 className="text-lg font-bold text-zinc-900 dark:text-white">
                                            Add Relay
                                        </h3>
                                        <div className="space-y-2">
                                            <input
                                                type="text"
                                                value={newRelayUrl}
                                                onChange={(e) => {
                                                    setNewRelayUrl(e.target.value);
                                                    setRelayError(null);
                                                }}
                                                placeholder="wss://relay.example.com"
                                                className="w-full h-12 rounded-xl bg-zinc-100 dark:bg-white/5 border border-black/5 dark:border-white/10 px-4 text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                autoFocus
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') handleAddRelay();
                                                    if (e.key === 'Escape') setIsAddingRelay(false);
                                                }}
                                            />
                                            {relayError && (
                                                <p className="text-xs text-red-500 ml-1">{relayError}</p>
                                            )}
                                        </div>
                                        <div className="flex gap-3">
                                            <button
                                                onClick={() => setIsAddingRelay(false)}
                                                className="flex-1 h-11 rounded-xl bg-zinc-200 dark:bg-white/10 text-zinc-600 dark:text-white/70 font-medium transition-all active:scale-95"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={handleAddRelay}
                                                disabled={isRelayLoading || !newRelayUrl.trim()}
                                                className="flex-1 h-11 rounded-xl bg-[#007AFF] text-white font-medium disabled:opacity-50 transition-all active:scale-95"
                                            >
                                                {isRelayLoading ? '...' : 'Add'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}


                            {/* Hide List Section */}
                            <div className="space-y-4">
                                <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-400 dark:text-white/20 ml-2">Hide List</h4>
                                <div className="space-y-0.5 rounded-[2rem] overflow-hidden bg-zinc-50 dark:bg-white/[0.03] border border-black/5 dark:border-white/5">
                                    <button
                                        onClick={() => setShowHideList(!showHideList)}
                                        className="w-full p-5 flex items-center justify-between transition-colors"
                                        style={{ WebkitTapHighlightColor: 'transparent' }}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="p-2.5 rounded-xl bg-amber-500/10 dark:bg-amber-500/20 text-amber-500"><EyeOff size={20} /></div>
                                            <span className="font-semibold text-sm text-zinc-700 dark:text-white">Manage List ({hiddenItems.length})</span>
                                        </div>
                                        <span className="text-xs text-zinc-400 dark:text-white/40">{showHideList ? 'Hide' : 'Show'}</span>
                                    </button>

                                    {showHideList && (
                                        <>
                                            <div className="h-[1px] bg-black/5 dark:bg-white/5 mx-4" />
                                            <div className="p-4 space-y-2">
                                                {hiddenItems.length === 0 ? (
                                                    <p className="text-sm text-zinc-400 dark:text-white/40 text-center py-2">No hidden items</p>
                                                ) : (
                                                    hiddenItems.map(item => (
                                                        <div key={item.id} className="flex items-center justify-between p-3 rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10">
                                                            <div className="flex items-center gap-2 min-w-0">
                                                                <span className="shrink-0">{item.type === 'listing' ? '📄' : '👤'}</span>
                                                                <span className="text-sm text-zinc-600 dark:text-white/70 truncate">{item.name}</span>
                                                                <span className="shrink-0 text-[10px] uppercase px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-white/10 text-zinc-400">{item.type}</span>
                                                            </div>
                                                            <button
                                                                onClick={() => unhideItem(item.id)}
                                                                className="p-2 text-zinc-400 hover:text-green-500 transition-colors shrink-0"
                                                                style={{ WebkitTapHighlightColor: 'transparent' }}
                                                            >
                                                                <Check size={16} />
                                                            </button>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </>
                                    )}
                                </div>
                                <p className="text-xs text-zinc-400 dark:text-white/30 text-center">
                                    ℹ️ Listings you hide can be managed here
                                </p>
                            </div>

                            <div className="space-y-4">
                                <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-400 dark:text-white/20 ml-2">Parking History</h4>

                                {setHistorySpots && (
                                    <div className="flex items-center justify-between p-4 bg-zinc-50 dark:bg-white/5 rounded-[2rem] border border-black/5 dark:border-white/5">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2.5 rounded-xl bg-purple-500/10 dark:bg-purple-500/20 text-purple-500 dark:text-purple-400"><MapPin size={20} /></div>
                                            <span className="font-semibold text-sm text-zinc-700 dark:text-white">Show logs on map</span>
                                        </div>
                                        <button
                                            onClick={() => setShowHistoryOnMap(!showHistoryOnMap)}
                                            className={`w-12 h-7 rounded-full transition-colors relative ${showHistoryOnMap ? 'bg-[#007AFF]' : 'bg-zinc-200 dark:bg-white/20'}`}
                                        >
                                            <div className={`absolute top-1 bottom-1 w-5 h-5 rounded-full bg-white transition-transform ${showHistoryOnMap ? 'left-[calc(100%-1.25rem-0.25rem)]' : 'left-1'}`} />
                                        </button>
                                    </div>
                                )}

                                {/* Filters Container */}
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center gap-2 p-1 bg-zinc-100 dark:bg-white/5 rounded-[1.5rem] border border-black/5 dark:border-white/5">
                                        {(['all', 'bicycle', 'motorcycle', 'car'] as const).map((type) => (
                                            <button
                                                key={type}
                                                onClick={() => setFilterType(type)}
                                                className={`flex-1 flex items-center justify-center py-2.5 rounded-[1.2rem] text-sm transition-all active:scale-95 ${filterType === type
                                                    ? 'bg-white dark:bg-white/10 text-zinc-900 dark:text-white font-bold shadow-sm'
                                                    : 'text-zinc-400 dark:text-white/40 hover:text-zinc-600 dark:hover:text-white/60'
                                                    }`}
                                            >
                                                {type === 'all' ? 'All' : <span className="text-xl">{type === 'bicycle' ? '🚲' : type === 'motorcycle' ? '🏍️' : '🚗'}</span>}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {filteredLogs.length > 0 ? (
                                    filteredLogs.map((log) => {
                                        const content = log.decryptedContent;
                                        const currencySymbol = getCurrencySymbol(content.currency || 'USD');
                                        const startTime = content.started_at ? new Date(content.started_at * 1000) : null;
                                        const endTime = content.finished_at ? new Date(content.finished_at * 1000) : new Date(log.created_at * 1000);
                                        const coords = content.lat && content.lon ? `${content.lat.toFixed(5)}, ${content.lon.toFixed(5)}` : null;
                                        const duration = formatDuration(startTime, endTime);
                                        const dateStr = startTime ? startTime.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : endTime.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

                                        // Read type from encrypted content (not public tags for privacy)
                                        const type = content.type || 'car';
                                        const typeEmoji = type === 'bicycle' ? '🚲' : type === 'motorcycle' ? '🏍️' : '🚗';
                                        const isEditingNote = editingNoteLogId === log.id;

                                        return (
                                            <div key={log.id} className="p-5 rounded-[2rem] bg-zinc-50 dark:bg-white/[0.03] space-y-3 border border-black/5 dark:border-white/5 text-zinc-900 dark:text-white">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-2xl">{typeEmoji}</span>
                                                        <p className="font-bold text-xl">{`${currencySymbol}${content.fee || '0'}`}</p>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-2xl">{getCountryFlag(content.currency || 'USD')}</span>
                                                        <button
                                                            onClick={() => handleDeleteLog(log)}
                                                            className="p-1.5 text-zinc-400 dark:text-white/30 transition-colors"
                                                            title="Delete entry"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Duration and Date */}
                                                <div className="flex items-center gap-4 text-xs">
                                                    <div className="flex items-center gap-2 text-zinc-500 dark:text-white/50">
                                                        <Clock size={12} className="text-green-500 dark:text-green-400" />
                                                        <span className="font-semibold">{duration}</span>
                                                    </div>
                                                    <span className="text-zinc-400 dark:text-white/30">{dateStr}</span>
                                                </div>

                                                {coords && (
                                                    <div className="flex items-center gap-2 text-xs text-zinc-400 dark:text-white/40">
                                                        <MapPin size={12} className="text-[#007AFF]" />
                                                        <span className="font-mono">{coords}</span>
                                                    </div>
                                                )}

                                                {/* Note Section */}
                                                <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-white/50 bg-zinc-100 dark:bg-white/5 rounded-lg px-3 py-2">
                                                    {isEditingNote ? (
                                                        <>
                                                            <input
                                                                type="text"
                                                                value={editingNoteValue}
                                                                onChange={(e) => setEditingNoteValue(e.target.value)}
                                                                placeholder="Add note"
                                                                className="flex-1 min-w-0 text-sm bg-white dark:bg-white/10 rounded-lg px-2 py-1 text-zinc-700 dark:text-white border border-[#007AFF]"
                                                                autoFocus
                                                                onFocus={(e) => e.currentTarget.select()}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter') handleUpdateNote(log, editingNoteValue);
                                                                    if (e.key === 'Escape') setEditingNoteLogId(null);
                                                                }}
                                                            />
                                                            <button
                                                                onClick={() => handleUpdateNote(log, editingNoteValue)}
                                                                disabled={isSavingNote}
                                                                className="p-2 rounded-xl text-green-500 bg-green-500/10 transition-colors disabled:opacity-50"
                                                            >
                                                                <Check size={16} />
                                                            </button>
                                                            <button
                                                                onClick={() => setEditingNoteLogId(null)}
                                                                className="p-2 rounded-xl text-zinc-400 bg-zinc-500/10 transition-colors"
                                                            >
                                                                <X size={16} />
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <span
                                                                className={`flex-1 text-left cursor-pointer ${content.note ? '' : 'text-zinc-400 dark:text-white/30'}`}
                                                                onClick={() => {
                                                                    setEditingNoteLogId(log.id);
                                                                    setEditingNoteValue(content.note || '');
                                                                }}
                                                            >
                                                                {content.note || 'Add note'}
                                                            </span>
                                                            <button
                                                                onClick={() => {
                                                                    setEditingNoteLogId(log.id);
                                                                    setEditingNoteValue(content.note || '');
                                                                }}
                                                                className="p-1 text-zinc-400 dark:text-white/30 shrink-0"
                                                            >
                                                                <Pencil size={12} />
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <div className="p-10 rounded-[2.5rem] border-2 border-dashed border-black/5 dark:border-white/5 text-center">
                                        <p className="text-sm font-medium text-zinc-400 dark:text-white/10">
                                            {decryptedLogs.length > 0 ? 'No entries match filters' : 'No recent activity'}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>

                        <button
                            onClick={() => { logout(); setIsOpen(false); }}
                            className="w-full py-5 rounded-[2rem] bg-zinc-100 dark:bg-zinc-800 text-red-500 font-bold tracking-wide border border-black/5 dark:border-white/5 transition-all active:scale-95 text-center mt-4"
                        >
                            Logout
                        </button>
                    </div>
                </div>
            )}
        </>
    );
};
