import React, { ReactNode, useState, useEffect } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { Zap, Sliders, Settings, Activity, LogOut, User, BarChart3 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { TransitionLink } from "./TransitionLink";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";

interface LayoutProps {
  children: ReactNode;
  title?: string;
}

export function Layout({ children, title }: LayoutProps) {
  const router = useRouter();
  const { user, isLoading, logout } = useAuth();
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 25);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

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
          <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
          <link rel="alternate icon" href="/favicon.ico" />
        </Head>
        <div
          role="status"
          aria-live="polite"
          className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400"
        >
          <div className="flex items-center gap-3 p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur animate-fade-in shadow-xl">
            <Zap className="w-5 h-5 text-emerald-400 animate-pulse animate-float" aria-hidden="true" />
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
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="alternate icon" href="/favicon.ico" />
      </Head>
      <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
        <header
          role="banner"
          className={`site-header border-b border-slate-800/90 backdrop-blur-md sticky top-0 z-40 transition-all duration-300 ease-in-out ${
            isScrolled
              ? "bg-slate-950/85 shadow-lg shadow-black/40 border-slate-800"
              : "bg-slate-900/70"
          }`}
        >
          <div
            className={`max-w-6xl mx-auto px-4 flex items-center justify-between transition-all duration-300 ease-in-out ${
              isScrolled ? "h-12" : "h-16"
            }`}
          >
            <TransitionLink
              href="/"
              aria-label="WattFlow Início"
              className="flex items-center gap-2 group transition-transform active:scale-95 duration-150"
            >
              <div
                className={`rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 group-hover:scale-105 group-hover:bg-emerald-500/20 group-hover:border-emerald-500/50 transition-all duration-300 shadow-sm shadow-emerald-950 ${
                  isScrolled ? "p-1.5" : "p-2"
                }`}
              >
                <Zap
                  className={`transition-all duration-300 group-hover:rotate-6 ${
                    isScrolled ? "w-4 h-4" : "w-5 h-5"
                  }`}
                  aria-hidden="true"
                />
              </div>
              <div className="flex items-baseline">
                <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">
                  WattFlow
                </span>
                <span
                  className={`text-[10px] text-slate-400 ml-1.5 font-mono overflow-hidden transition-all duration-300 ${
                    isScrolled ? "max-w-0 opacity-0" : "max-w-xs opacity-100"
                  }`}
                >
                  MVP
                </span>
              </div>
            </TransitionLink>

            <div className="flex items-center gap-2 sm:gap-4">
              <nav
                role="navigation"
                aria-label="Navegação Principal"
                className="flex items-center gap-1 sm:gap-1.5"
              >
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = router.pathname === item.href;
                  return (
                    <Tooltip key={item.href} enabled={isScrolled}>
                      <TooltipTrigger asChild>
                        <TransitionLink
                          href={item.href}
                          aria-current={isActive ? "page" : undefined}
                          aria-label={item.label}
                          className={`flex items-center rounded-lg font-medium transition-all duration-300 active:scale-95 ${
                            isScrolled ? "px-2.5 py-1.5 text-xs gap-1.5" : "px-3 py-2 text-sm gap-2"
                          } ${
                            isActive
                              ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 shadow-sm shadow-emerald-950"
                              : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 hover:border-slate-700/60 border border-transparent"
                          }`}
                        >
                          <Icon
                            className={`transition-all duration-300 ${
                              isScrolled ? "w-3.5 h-3.5" : "w-4 h-4"
                            } ${isActive ? "scale-105" : "group-hover:scale-105"}`}
                            aria-hidden="true"
                          />
                          <span
                            className={`hidden sm:inline overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out ${
                              isScrolled ? "max-w-0 opacity-0 -ml-0.5" : "max-w-[160px] opacity-100 ml-0"
                            }`}
                          >
                            {item.label}
                          </span>
                        </TransitionLink>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">{item.label}</TooltipContent>
                    </Tooltip>
                  );
                })}
              </nav>

              {user && (
                <div className="flex items-center gap-2 sm:gap-3 border-l border-slate-800/80 pl-2 sm:pl-3">
                  <Tooltip enabled={isScrolled}>
                    <TooltipTrigger asChild>
                      <TransitionLink
                        href="/profile"
                        aria-label={`Meu Perfil (${user.fullName || user.email})`}
                        className={`flex items-center gap-1.5 text-xs rounded-lg border transition-all duration-300 ${
                          router.pathname === "/profile"
                            ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                            : "text-slate-300 bg-slate-900/50 border-slate-800 hover:bg-slate-800/80 hover:border-slate-700 hover:text-white"
                        } ${isScrolled ? "p-1.5 md:px-2 md:py-1" : "p-1.5 sm:px-2.5 sm:py-1.5"}`}
                      >
                        <div
                          className={`p-0.5 rounded-full border transition-colors ${
                            router.pathname === "/profile"
                              ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                              : "bg-slate-800 border-slate-700 text-emerald-400"
                          }`}
                        >
                          <User className="w-3.5 h-3.5" aria-hidden="true" />
                        </div>
                        <span
                          className={`hidden md:inline truncate font-medium transition-all duration-300 ${
                            isScrolled ? "max-w-[80px] text-[11px]" : "max-w-[140px]"
                          }`}
                        >
                          {user.fullName || user.email}
                        </span>
                      </TransitionLink>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Meu Perfil e Segurança</TooltipContent>
                  </Tooltip>

                  <Tooltip enabled={isScrolled}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={logout}
                        aria-label="Sair da Conta"
                        className={`rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 active:scale-90 transition-all duration-200 cursor-pointer ${
                          isScrolled ? "p-1.5" : "p-2"
                        }`}
                      >
                        <LogOut className={isScrolled ? "w-3.5 h-3.5" : "w-4 h-4"} aria-hidden="true" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Sair da Conta</TooltipContent>
                  </Tooltip>
                </div>
              )}
            </div>
          </div>
        </header>

        <main
          role="main"
          className="flex-1 max-w-6xl w-full mx-auto px-4 py-8 page-content animate-fade-in"
        >
          {title && (
            <div className="mb-8 animate-slide-down">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-100">{title}</h1>
            </div>
          )}
          {children}
        </main>

        <footer
          role="contentinfo"
          className="border-t border-slate-800/80 py-6 text-center text-xs text-slate-500"
        >
          <p><strong className="font-semibold text-slate-400">wattflow</strong> - desenvolvido com ♥ por Braine</p>
        </footer>
      </div>
    </>
  );
}
