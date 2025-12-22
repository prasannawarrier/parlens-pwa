import React, { useState, useEffect } from 'react';
import { Search, Car, MapPin, ArrowRight, ChevronUp, ChevronDown } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { KINDS, DEFAULT_RELAYS } from '../lib/nostr';
import { encodeGeohash } from '../lib/geo';
import { encryptParkingLog } from '../lib/encryption';
import { getCurrencyFromLocation, getCurrencySymbol, getLocalCurrency } from '../lib/currency';

interface FABProps {
    status: 'idle' | 'search' | 'parked';
    setStatus: (s: 'idle' | 'search' | 'parked') => void;
    location: [number, number];
}

export const FAB: React.FC<FABProps> = ({ status, setStatus, location }) => {
    const { pubkey, pool, signEvent } = useAuth();
    const [showCostPopup, setShowCostPopup] = useState(false);
    const [cost, setCost] = useState('0');
    const [currency, setCurrency] = useState('USD');
    const [symbol, setSymbol] = useState('$');
    const [sessionStart, setSessionStart] = useState<number | null>(null);
    const [parkLocation, setParkLocation] = useState<[number, number] | null>(null);

    useEffect(() => {
        const detectCurrency = async () => {
            // First use locale as fallback
            const localCurrency = getLocalCurrency();
            setCurrency(localCurrency);
            setSymbol(getCurrencySymbol(localCurrency));

            // Then try GPS-based detection
            if (location) {
                try {
                    const gpsCurrency = await getCurrencyFromLocation(location[0], location[1]);
                    setCurrency(gpsCurrency);
                    setSymbol(getCurrencySymbol(gpsCurrency));
                } catch (e) {
                    console.warn('GPS currency detection failed');
                }
            }
        };
        detectCurrency();
    }, [location]);

    const handleClick = async () => {
        if (status === 'idle') {
            setStatus('search');
        } else if (status === 'search') {
            setSessionStart(Math.floor(Date.now() / 1000));
            setParkLocation([location[0], location[1]]);
            setStatus('parked');
        } else if (status === 'parked') {
            setShowCostPopup(true);
        }
    };

    const handleFinishParking = async () => {
        setStatus('idle');
        setShowCostPopup(false);

        const lat = parkLocation ? parkLocation[0] : location[0];
        const lon = parkLocation ? parkLocation[1] : location[1];
        const geohash = encodeGeohash(lat, lon);
        const endTime = Math.floor(Date.now() / 1000);
        const startTime = sessionStart || endTime;

        try {
            const logContent = {
                status: 'vacated',
                lat,
                lon,
                geohash,
                fee: cost,
                currency,
                started_at: startTime,
                finished_at: endTime
            };

            const privkeyHex = localStorage.getItem('parlens_privkey');
            const seckey = privkeyHex ? new Uint8Array(privkeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))) : undefined;

            const encryptedContent = await encryptParkingLog(logContent, pubkey!, seckey);

            const logEvent = {
                kind: KINDS.PARKING_LOG, // Parameterized Replaceable for history
                content: encryptedContent,
                tags: [
                    ['g', geohash],
                    ['client', 'parlens'],
                    ['d', `session_${startTime}`] // Unique ID for history
                ],
                created_at: endTime,
                pubkey: pubkey!,
            };

            const signedLog = await signEvent(logEvent);

            console.log('Publishing log:', signedLog.id, 'to', DEFAULT_RELAYS);
            const pubs = pool.publish(DEFAULT_RELAYS, signedLog);

            // Wait for all publishes to at least attempt
            await Promise.allSettled(pubs);
            console.log('Log published');

            // Broadcast open spot (Kind 21011) to help other users
            // Calculate hourly rate based on duration and fee
            const durationHours = Math.max((endTime - startTime) / 3600, 0.1); // Minimum 0.1 hours
            const hourlyRate = (parseFloat(cost) / durationHours).toFixed(2);

            const broadcastEvent = {
                kind: KINDS.OPEN_SPOT_BROADCAST,
                content: '',
                tags: [
                    ['g', geohash],
                    ['location', `${lat},${lon}`],
                    ['hourly_rate', hourlyRate],
                    ['currency', currency],
                    ['client', 'parlens']
                ],
                created_at: endTime,
                pubkey: pubkey!,
            };

            const signedBroadcast = await signEvent(broadcastEvent);
            console.log('Broadcasting open spot:', signedBroadcast.id);
            pool.publish(DEFAULT_RELAYS, signedBroadcast);

            // Reset session tracking
            setSessionStart(null);
            setParkLocation(null);

        } catch (e) {
            console.error('Persistence error:', e);
            alert('Could not save to Nostr. Check relay connections.');
        }
    };

    return (
        <div className="relative flex flex-col items-end gap-4">
            <div className="flex items-center gap-4">
                {status === 'search' && (
                    <button
                        onClick={() => setStatus('idle')}
                        className="h-14 px-8 rounded-full bg-red-500/90 text-white font-bold text-xs tracking-widest shadow-2xl backdrop-blur-md animate-in slide-in-from-left-8"
                    >
                        CANCEL
                    </button>
                )}

                <button
                    onClick={handleClick}
                    className={`h-20 w-20 flex items-center justify-center rounded-3xl shadow-2xl transition-all active:scale-90 ${status === 'idle' ? 'bg-[#007AFF] text-white shadow-blue-500/20' :
                        status === 'search' ? 'bg-[#FF9500] text-white shadow-orange-500/20' :
                            'bg-[#34C759] text-white shadow-green-500/20'
                        }`}
                >
                    {status === 'idle' && <Search size={32} strokeWidth={2.5} />}
                    {status === 'search' && <MapPin size={32} strokeWidth={2.5} className="animate-pulse" />}
                    {status === 'parked' && <Car size={32} strokeWidth={2.5} />}
                </button>
            </div>

            {showCostPopup && (
                <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-xl animate-in fade-in duration-300 p-6">
                    <div className="w-full max-w-md bg-[#1c1c1e] rounded-[2.5rem] shadow-2xl p-10 flex flex-col items-center space-y-8 animate-in zoom-in-95">
                        <div className="text-center space-y-2">
                            <h3 className="text-3xl font-bold tracking-tight">Session Ended</h3>
                            <p className="text-sm font-medium text-white/40">Enter the total parking fee</p>
                        </div>


                        <div className="flex items-center gap-6">
                            {/* Currency symbol and amount */}
                            <div className="flex items-center gap-4 bg-white/5 px-8 py-6 rounded-[2rem] border border-white/5">
                                <span className="text-4xl font-bold text-blue-500">{symbol}</span>
                                <input
                                    type="number"
                                    value={cost}
                                    onChange={(e) => setCost(e.target.value)}
                                    autoFocus
                                    className="w-28 bg-transparent text-6xl font-black text-center text-white focus:outline-none placeholder:text-white/10 appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
                                    min="0"
                                />
                                <span className="text-lg font-bold text-white/20">{currency}</span>
                            </div>

                            {/* Up/Down buttons */}
                            <div className="flex flex-col gap-2">
                                <button
                                    onClick={() => setCost(String(Math.max(0, parseFloat(cost || '0') + 1)))}
                                    className="h-14 w-14 rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 transition-all flex items-center justify-center"
                                >
                                    <ChevronUp size={28} className="text-white/70" />
                                </button>
                                <button
                                    onClick={() => setCost(String(Math.max(0, parseFloat(cost || '0') - 1)))}
                                    className="h-14 w-14 rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 transition-all flex items-center justify-center"
                                >
                                    <ChevronDown size={28} className="text-white/70" />
                                </button>
                            </div>
                        </div>

                        <div className="w-full space-y-4 mt-4">
                            <button
                                onClick={handleFinishParking}
                                className="w-full h-20 rounded-[2rem] bg-[#007AFF] text-white text-xl font-bold flex items-center justify-center gap-3 shadow-xl active:scale-95 transition-all"
                            >
                                Log Parking <ArrowRight size={24} />
                            </button>

                            <button
                                onClick={() => setShowCostPopup(false)}
                                className="w-full text-sm font-bold text-white/30 tracking-widest uppercase py-4"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>

                </div>
            )}
        </div>
    );
};
