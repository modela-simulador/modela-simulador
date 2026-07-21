"use client";

import { useState, useEffect } from "react";
import { login, isAuthenticated, getUsername, logout } from "@/lib/auth";
import { BASE_PATH } from "@/lib/base-path";

export default function LandingPage() {
  const [authed, setAuthed] = useState(false);
  const [username, setUsername] = useState("");
  const [checking, setChecking] = useState(true);

  // Check existing session
  useEffect(() => {
    const ok = isAuthenticated();
    setAuthed(ok);
    if (ok) setUsername(getUsername());
    setChecking(false);
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen bg-[#1A1825] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!authed) {
    return <LoginScreen onSuccess={(name) => { setAuthed(true); setUsername(name); }} />;
  }

  return <AppSelector username={username} onLogout={() => { logout(); setAuthed(false); setUsername(""); }} />;
}

// ── Login Screen ──────────────────────────────────────────

function LoginScreen({ onSuccess }: { onSuccess: (name: string) => void }) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [locked, setLocked] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (locked || loading) return;

    setLoading(true);
    setError("");

    const result = await login(user, pass);

    if (result.success) {
      onSuccess(result.name!);
    } else {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      if (newAttempts >= 5) {
        setLocked(true);
        setError("Demasiados intentos. Espere 60 segundos.");
        setTimeout(() => { setLocked(false); setAttempts(0); }, 60000);
      } else {
        setError(result.error || "Error de autenticacion");
      }
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-[#1A1825] via-[#1f1b2e] to-[#153E6B] px-6 relative overflow-hidden">
      {/* Subtle radial glows */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute w-[600px] h-[600px] left-[10%] top-[60%] -translate-y-1/2 rounded-full bg-[#2B6CB0]/10 blur-[120px]" />
        <div className="absolute w-[400px] h-[400px] right-[15%] top-[20%] rounded-full bg-[#a89867]/8 blur-[100px]" />
      </div>

      {/* Logo Modela (desde modela.cl) */}
      <div className="relative mb-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`${BASE_PATH}/logo_modela.webp`}
          alt="Modela"
          className="h-24 w-auto drop-shadow-xl"
        />
      </div>

      <p className="text-white/60 text-base mb-10 font-light tracking-wide relative">
        Plataforma de desarrollo inmobiliario
      </p>

      {/* Login card */}
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-[380px] bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-9 relative"
      >
        <h2 className="text-lg font-semibold text-white/90 text-center mb-6">
          Iniciar Sesion
        </h2>

        <div className="mb-4">
          <label className="block text-[13px] font-medium text-white/50 mb-1.5">Usuario</label>
          <input
            type="text"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="Ingresa tu usuario"
            autoComplete="username"
            className="w-full px-3.5 py-2.5 bg-white/6 border border-white/12 rounded-lg text-white text-sm placeholder:text-white/25 focus:border-[#a89867] focus:ring-2 focus:ring-[#a89867]/15 focus:bg-white/8 outline-none transition-all"
          />
        </div>

        <div className="mb-5">
          <label className="block text-[13px] font-medium text-white/50 mb-1.5">Contrasena</label>
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="Ingresa tu contrasena"
            autoComplete="current-password"
            className="w-full px-3.5 py-2.5 bg-white/6 border border-white/12 rounded-lg text-white text-sm placeholder:text-white/25 focus:border-[#a89867] focus:ring-2 focus:ring-[#a89867]/15 focus:bg-white/8 outline-none transition-all"
          />
        </div>

        {error && (
          <div className="text-[#fca5a5] text-xs text-center mb-4 px-3 py-2 bg-red-600/15 rounded-lg">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || locked}
          className="w-full py-3 bg-[#a89867] hover:bg-[#c4b58a] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-lg transition-all shadow-lg shadow-[#a89867]/30 hover:-translate-y-0.5"
        >
          {loading ? "Verificando..." : "Entrar"}
        </button>
      </form>

      <span className="absolute bottom-6 text-xs text-white/40 tracking-wider">
        MODELA 2026
      </span>
    </div>
  );
}

// ── App Selector ──────────────────────────────────────────

function AppSelector({ username, onLogout }: { username: string; onLogout: () => void }) {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-[#1A1825] via-[#1f1b2e] to-[#153E6B] relative overflow-hidden">
      {/* Background glows */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute w-[700px] h-[700px] left-[5%] bottom-0 rounded-full bg-[#2B6CB0]/8 blur-[150px]" />
        <div className="absolute w-[500px] h-[500px] right-[10%] top-[10%] rounded-full bg-[#a89867]/6 blur-[120px]" />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-8 py-5">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${BASE_PATH}/logo_modela.webp`}
            alt="Modela"
            className="h-10 w-auto"
          />
        </div>
        <div className="flex items-center gap-4">
          <span className="text-white/50 text-sm">{username}</span>
          <button
            onClick={onLogout}
            className="px-3 py-1.5 border border-white/15 rounded-md text-white/50 text-xs hover:bg-red-500/10 hover:border-red-400/30 hover:text-red-300 transition-all"
          >
            Cerrar sesion
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 -mt-10">
        <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2 text-center">
          Selecciona una herramienta
        </h1>
        <p className="text-white/40 text-sm mb-12 text-center">
          Elige el modulo al que quieres acceder
        </p>

        {/* Dos opciones principales en fila superior */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-5xl mb-6">
          {/* Simulador Inmobiliario (el actual en GitHub Pages) */}
          <a
            href={`${BASE_PATH}/simulador-legacy.html`}
            className="group relative bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-10 hover:bg-white/8 hover:border-[#2B6CB0]/40 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-[#2B6CB0]/10 cursor-pointer block"
          >
            <div className="w-20 h-20 rounded-xl bg-gradient-to-br from-[#2B6CB0] to-[#153E6B] flex items-center justify-center mb-6 group-hover:scale-105 transition-transform shadow-lg shadow-[#2B6CB0]/20">
              <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
            </div>

            <h2 className="text-2xl font-bold text-white mb-3 group-hover:text-[#93c5fd] transition-colors">
              Simulador Inmobiliario
            </h2>
            <p className="text-white/50 text-sm leading-relaxed mb-5">
              Modelo de negocio completo: flujo de caja, VAN, TIR, etapamiento financiero y sensibilidad de variables.
            </p>

            <div className="flex flex-wrap gap-2">
              <span className="px-3 py-1 bg-[#2B6CB0]/15 text-[#93c5fd] text-[11px] font-medium rounded-md">Flujo de Caja</span>
              <span className="px-3 py-1 bg-[#2B6CB0]/15 text-[#93c5fd] text-[11px] font-medium rounded-md">VAN / TIR</span>
              <span className="px-3 py-1 bg-[#2B6CB0]/15 text-[#93c5fd] text-[11px] font-medium rounded-md">Sensibilidad</span>
            </div>

            <div className="absolute top-10 right-10 w-9 h-9 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-[#2B6CB0]/20 transition-colors">
              <svg className="w-5 h-5 text-white/30 group-hover:text-white/70 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </div>
          </a>

          {/* Valorización de Suelos */}
          <a
            href={`${BASE_PATH}/residual`}
            className="group relative bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-10 hover:bg-white/8 hover:border-[#22c55e]/40 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-[#22c55e]/10 cursor-pointer block"
          >
            <div className="w-20 h-20 rounded-xl bg-gradient-to-br from-[#22c55e] to-[#15803d] flex items-center justify-center mb-6 group-hover:scale-105 transition-transform shadow-lg shadow-[#22c55e]/20">
              <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>

            <h2 className="text-2xl font-bold text-white mb-3 group-hover:text-[#86efac] transition-colors">
              Valorización de Suelos
            </h2>
            <p className="text-white/50 text-sm leading-relaxed mb-5">
              Método residual dinámico: selecciona un lote, define el producto inmobiliario y obtén el valor del terreno en UF/m² con la TIR objetivo.
            </p>

            <div className="flex flex-wrap gap-2">
              <span className="px-3 py-1 bg-[#22c55e]/15 text-[#86efac] text-[11px] font-medium rounded-md">Valor Terreno</span>
              <span className="px-3 py-1 bg-[#22c55e]/15 text-[#86efac] text-[11px] font-medium rounded-md">Incidencia</span>
              <span className="px-3 py-1 bg-[#22c55e]/15 text-[#86efac] text-[11px] font-medium rounded-md">TIR / VAN</span>
            </div>

            <div className="absolute top-10 right-10 w-9 h-9 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-[#22c55e]/20 transition-colors">
              <svg className="w-5 h-5 text-white/30 group-hover:text-white/70 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </div>
          </a>
        </div>

        {/* Opciones secundarias: Cabidas + Conectividad */}
        <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-4">
          <a
            href={`${BASE_PATH}/cabidas`}
            className="group relative flex items-center gap-4 bg-white/3 backdrop-blur-xl border border-white/10 rounded-xl px-6 py-4 hover:bg-white/6 hover:border-[#a89867]/40 transition-all duration-300"
          >
            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#a89867] to-[#7a6f4a] flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-white group-hover:text-[#c4b58a] transition-colors">
                  Cabidas Automáticas
                </h3>
                <span className="text-[10px] px-2 py-0.5 bg-white/5 border border-white/10 rounded text-white/40 tracking-wider uppercase">Beta</span>
              </div>
              <p className="text-white/40 text-xs leading-relaxed mt-0.5 truncate">
                Generador de subdivisión automática, mix de productos, etapamiento BFS y análisis de negocio.
              </p>
            </div>
            <svg className="w-5 h-5 text-white/30 group-hover:text-white/70 transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </a>

          {/* Conectividad (app propia, servida en /conectividad/) */}
          <a
            href={`${BASE_PATH}/conectividad/`}
            className="group relative flex items-center gap-4 bg-white/3 backdrop-blur-xl border border-white/10 rounded-xl px-6 py-4 hover:bg-white/6 hover:border-[#22d3ee]/40 transition-all duration-300"
          >
            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#22d3ee] to-[#0e7490] flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <circle cx="6" cy="18" r="2.2" />
                <circle cx="18" cy="6" r="2.2" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 18h6a4 4 0 000-8H9a4 4 0 010-8h5" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-white group-hover:text-[#67e8f9] transition-colors">
                  Conectividad
                </h3>
                <span className="text-[10px] px-2 py-0.5 bg-[#22d3ee]/10 border border-[#22d3ee]/30 rounded text-[#67e8f9] tracking-wider uppercase">Nuevo</span>
              </div>
              <p className="text-white/40 text-xs leading-relaxed mt-0.5 truncate">
                Tiempo y costo puerta a puerta desde cada proyecto, hoy vs. el tren.
              </p>
            </div>
            <svg className="w-5 h-5 text-white/30 group-hover:text-white/70 transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </a>
        </div>
      </main>

      <footer className="relative z-10 text-center py-4">
        <span className="text-xs text-white/30 tracking-wider">MODELA 2026</span>
      </footer>
    </div>
  );
}
