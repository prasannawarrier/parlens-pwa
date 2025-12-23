import { SimplePool, getPublicKey, nip19, generateSecretKey, finalizeEvent } from 'nostr-tools';

const bytesToHex = (bytes: Uint8Array) =>
    Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

import React, { createContext, useContext, useState } from 'react';

interface AuthContextType {
    pubkey: string | null;
    login: (method: 'extension' | 'nsec' | 'bunker' | 'create', value?: string, username?: string) => Promise<void>;
    logout: () => void;
    pool: SimplePool;
    signEvent: (event: any) => Promise<any>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [pubkey, setPubkey] = useState<string | null>(localStorage.getItem('parlens_pubkey'));
    const [pool] = useState(new SimplePool());

    const login = async (method: 'extension' | 'nsec' | 'bunker' | 'create', value?: string, username?: string) => {
        let key = '';
        let privateKey: Uint8Array | null = null;

        if (method === 'extension') {
            if (!(window as any).nostr) {
                throw new Error('Nostr extension not found');
            }
            key = await (window as any).nostr.getPublicKey();
        } else if (method === 'nsec' && value) {
            try {
                const decoded = nip19.decode(value);
                if (decoded.type !== 'nsec') throw new Error('Not an nsec');
                privateKey = decoded.data as Uint8Array;
                key = getPublicKey(privateKey);
                localStorage.setItem('parlens_privkey', bytesToHex(privateKey));
            } catch (e) {
                throw new Error('Invalid nsec format');
            }
        } else if (method === 'create') {
            privateKey = generateSecretKey();
            key = getPublicKey(privateKey);
            localStorage.setItem('parlens_privkey', bytesToHex(privateKey));
        }

        setPubkey(key);
        localStorage.setItem('parlens_pubkey', key);

        // Publish metadata if creating account
        if (method === 'create' && username && privateKey) {
            try {
                const event = finalizeEvent({
                    kind: 0,
                    created_at: Math.floor(Date.now() / 1000),
                    tags: [],
                    content: JSON.stringify({
                        name: username,
                        display_name: username,
                        picture: `https://api.dicebear.com/7.x/bottts/svg?seed=${key}`
                    }),
                }, privateKey);

                await Promise.any([
                    pool.publish(['wss://relay.damus.io', 'wss://nos.lol'], event)
                ]);
            } catch (e) {
                console.warn('Failed to publish metadata:', e);
            }
        }
    };

    const logout = () => {
        setPubkey(null);
        localStorage.removeItem('parlens_pubkey');
        localStorage.removeItem('parlens_privkey');
    };

    const signEvent = async (event: any) => {
        const privkeyHex = localStorage.getItem('parlens_privkey');
        if (privkeyHex) {
            const privkey = new Uint8Array(privkeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
            return finalizeEvent(event, privkey);
        }

        if ((window as any).nostr) {
            return await (window as any).nostr.signEvent(event);
        }

        throw new Error('No signing method available');
    };

    return (
        <AuthContext.Provider value={{ pubkey, login, logout, pool, signEvent }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within AuthProvider');
    return context;
};
