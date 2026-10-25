import React, { ReactNode } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { Zap, Sliders, Settings, Activity, LogOut, User, BarChart3 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { TransitionLink } from "./TransitionLink";

interface LayoutProps {
  children: ReactNode;
  title?: string;
}

export function Layout({ children, title }: LayoutProps) {
  const router = useRouter();
  const { user, isLoading, logout } = useAuth();

  const navItems = [
    { href: "/", label: "Dashboard", icon: Activity },
    { href: "/statistics", label: "Estatísticas", icon: BarChart3 },
    { href: "/automations", label: "Automações", icon: Sliders },
    { href: "/settings", label: "Credenciais (BYOK)", icon: Settings },
  ];

  const browserTitle = title
    ? `${title} | WattFlow`
    : "WattFlow - Orquestrador de Energia Inteligente";

  if (isLoading) {
    return (
      <>
        <Head>
          <title>{browserTitle}</title>
        </Head>
        <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
          <div className="flex items-center gap-3 p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur animate-fade-in">
            <Zap className="w-5 h-5 text-emerald-400 animate-pulse animate-float" />
            <span className="text-sm font-medium tracking-wide">Carregando WattFlow...</span>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>{browserTitle}</title>
      </Head>
      <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
        <header className="site-header border-b border-slate-800/90 bg-slate-900/70 backdrop-blur-md sticky top-0 z-50 transition-all duration-200">
          <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
            <TransitionLink href="/" className="flex items-center gap-2 group transition-transform active:scale-95 duration-150">
              <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 group-hover:scale-105 group-hover:bg-emerald-500/20 group-hover:border-emerald-500/50 transition-all duration-200 shadow-sm shadow-emerald-950">
                <Zap className="w-5 h-5 transition-transform group-hover:rotate-6 duration-200" />
              </div>
              <div>
                <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">
                  WattFlow
                </span>
                <span className="text-xs text-slate-400 ml-2 font-mono">MVP</span>
              </div>
            </TransitionLink>

            <div className="flex items-center gap-3 sm:gap-6">
              <nav className="flex items-center gap-1 sm:gap-2">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = router.pathname === item.href;
                  return (
                    <TransitionLink
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 active:scale-95 ${
                        isActive
                          ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 shadow-sm shadow-emerald-950"
                          : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 hover:border-slate-700/60 border border-transparent"
                      }`}
                    >
                      <Icon className={`w-4 h-4 transition-transform ${isActive ? "scale-105" : "group-hover:scale-105"}`} />
                      <span className="hidden sm:inline">{item.label}</span>
                    </TransitionLink>
                  );
                })}
              </nav>

              {user && (
                <div className="flex items-center gap-3 border-l border-slate-800/80 pl-3 sm:pl-4">
                  <div className="hidden md:flex items-center gap-2 text-xs text-slate-300 bg-slate-900/50 px-2.5 py-1.5 rounded-lg border border-slate-800 transition-colors">
                    <div className="p-1 rounded-full bg-slate-800 border border-slate-700">
                      <User className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    <span className="max-w-[140px] truncate font-medium">
                      {user.fullName || user.email}
                    </span>
                  </div>

                  <button
                    onClick={logout}
                    title="Sair da Conta"
                    className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 active:scale-90 transition-all duration-150"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8 page-content animate-fade-in">
          {title && (
            <div className="mb-8 animate-slide-down">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-100">{title}</h1>
            </div>
          )}
          {children}
        </main>

        <footer className="border-t border-slate-800/80 py-6 text-center text-xs text-slate-500">
          <p>WattFlow &bull; EcoFlow Open API + Chave de Transferência Automática (ATS) &bull; Object Calisthenics</p>
        </footer>
      </div>
    </>
  );
}
