import React, { useState } from 'react';
import { signInWithEmailAndPassword, setPersistence, browserLocalPersistence, browserSessionPersistence } from 'firebase/auth';
import { auth } from '../firebase';
import { Loader2, LogIn, AlertCircle, X } from 'lucide-react';

export default function LoginScreen() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [keepSignedIn, setKeepSignedIn] = useState(true);

    const handleLogin = async (e) => {
        e.preventDefault();
        if (!email || !password) {
            setError('Preencha email e senha.');
            return;
        }

        setError('');
        setLoading(true);

        try {
            const persistenceType = keepSignedIn ? browserLocalPersistence : browserSessionPersistence;
            await setPersistence(auth, persistenceType);
            await signInWithEmailAndPassword(auth, email, password);
            // O estado de autenticação mudará no App.jsx e esta tela será desmontada
        } catch (err) {
            console.error('Login error:', err);
            let msg = 'Falha ao autenticar.';
            if (err.code === 'auth/invalid-credential') msg = 'Email ou senha incorretos.';
            if (err.code === 'auth/too-many-requests') msg = 'Muitas tentativas. Tente novamente mais tarde.';
            setError(msg);
            setLoading(false);
        }
    };

    const handleQuit = () => {
        if (window.api?.closeWindow) {
            window.api.closeWindow();
        }
    };

    return (
        <div className="flex flex-col items-center justify-center h-screen w-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-slate-100 p-6 animate-in fade-in duration-500 relative drag-region">
            {/* Botão Fechar no Topo */}
            <button
                onClick={handleQuit}
                className="absolute top-4 right-4 no-drag rounded-full border border-white/10 p-2 text-slate-400 hover:bg-white/10 hover:text-white transition"
                title="Fechar Aplicativo"
            >
                <X size={16} />
            </button>

            <div className="w-full max-w-sm bg-slate-900/60 backdrop-blur-xl p-8 rounded-3xl shadow-glass border border-white/10 no-drag">
                <div className="flex flex-col items-center mb-8">
                    <div className="w-16 h-16 bg-gradient-to-tr from-emerald-500 to-emerald-600 rounded-2xl flex items-center justify-center mb-4 shadow-[0_0_20px_rgba(16,185,129,0.3)]">
                        <LogIn size={32} className="text-white ml-1" />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-100 tracking-tight">
                        Ambi Chat
                    </h1>
                    <p className="text-xs text-slate-400 mt-1 uppercase tracking-wider font-medium">Acesso Restrito</p>
                </div>

                <form onSubmit={handleLogin} className="space-y-4">
                    <div className="space-y-1">
                        <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 ml-1">Email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all placeholder:text-slate-600"
                            placeholder="seu.email@ambiental.sc"
                            autoFocus
                        />
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 ml-1">Senha</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all placeholder:text-slate-600"
                            placeholder="••••••••"
                        />
                    </div>

                    <div className="flex items-center gap-2 py-1">
                        <input
                            type="checkbox"
                            id="keepSignedIn"
                            checked={keepSignedIn}
                            onChange={(e) => setKeepSignedIn(e.target.checked)}
                            className="rounded border-white/10 bg-slate-800 text-emerald-500 focus:ring-emerald-500/50 focus:ring-offset-0 focus:ring-offset-slate-900"
                        />
                        <label htmlFor="keepSignedIn" className="text-xs text-slate-400 cursor-pointer select-none font-medium">
                            Manter conectado
                        </label>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 text-red-200 text-xs bg-red-500/10 p-3 rounded-xl border border-red-500/20">
                            <AlertCircle size={14} />
                            <span>{error}</span>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-emerald-500 hover:bg-emerald-400 text-white font-semibold py-3 rounded-xl transition-all shadow-lg shadow-emerald-500/20 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
                    >
                        {loading ? (
                            <>
                                <Loader2 size={18} className="animate-spin" />
                                <span>Entrando...</span>
                            </>
                        ) : (
                            <span>Acessar Sistema</span>
                        )}
                    </button>
                </form>

                <div className="mt-6 text-center">
                    <p className="text-[10px] text-slate-500 font-medium">
                        Ambiental Limpeza Urbana LTDA © 2026
                    </p>
                </div>
            </div>
        </div>
    );
}
