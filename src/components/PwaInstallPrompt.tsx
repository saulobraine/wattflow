import React, { useEffect, useState } from "react";
import { Download, X, Share, PlusSquare, Sparkles } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showAndroidPrompt, setShowAndroidPrompt] = useState(false);
  const [showIosPrompt, setShowIosPrompt] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    // Verifica se usuário já descartou o banner recentemente (7 dias)
    const dismissedUntil = localStorage.getItem("wf_pwa_prompt_dismissed");
    if (dismissedUntil && Number(dismissedUntil) > Date.now()) {
      setIsDismissed(true);
      return;
    }

    // 1. Detecção Android / Chromium (beforeinstallprompt)
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowAndroidPrompt(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);

    // 2. Detecção iOS Safari (não standalone)
    const isIos =
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      !(window as unknown as { MSStream: unknown }).MSStream;
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;

    if (isIos && !isStandalone) {
      // Exibe sutilmente para iOS após 3 segundos
      const timer = setTimeout(() => {
        setShowIosPrompt(true);
      }, 3000);
      return () => {
        window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
        clearTimeout(timer);
      };
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
    };
  }, []);

  const handleDismiss = () => {
    // Descarta por 7 dias
    localStorage.setItem(
      "wf_pwa_prompt_dismissed",
      String(Date.now() + 7 * 24 * 60 * 60 * 1000)
    );
    setIsDismissed(true);
    setShowAndroidPrompt(false);
    setShowIosPrompt(false);
  };

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setShowAndroidPrompt(false);
    }
    setDeferredPrompt(null);
  };

  if (isDismissed || (!showAndroidPrompt && !showIosPrompt)) {
    return null;
  }

  return (
    <aside
      aria-label="Instalar WattFlow App"
      className="fixed top-18 md:top-20 right-4 left-4 sm:left-auto sm:w-96 z-50 animate-slide-down"
    >
      <div className="p-4 rounded-2xl bg-slate-900/95 border border-emerald-500/40 shadow-2xl shadow-black/80 backdrop-blur-md text-slate-100 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <Sparkles className="w-5 h-5 animate-pulse" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
                Instale o App WattFlow
              </h3>
              <p className="text-xs text-slate-400">
                Acesso instantâneo, offline e sem barra de navegador
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Fechar convite de instalação"
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {showAndroidPrompt && (
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleDismiss}
              className="px-3 py-1.5 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all cursor-pointer"
            >
              Agora não
            </button>
            <button
              type="button"
              onClick={handleInstallClick}
              className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white transition-all shadow-md shadow-emerald-950 flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Instalar App
            </button>
          </div>
        )}

        {showIosPrompt && (
          <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-300 space-y-1.5 leading-relaxed font-sans">
            <div className="flex items-center gap-2 text-slate-200 font-semibold">
              <Share className="w-3.5 h-3.5 text-sky-400" />
              <span>Como instalar no Safari do iPhone:</span>
            </div>
            <ol className="list-decimal pl-4 space-y-1 text-[11px] text-slate-400">
              <li>
                Toque no botão <strong className="text-slate-200">Compartilhar</strong> na barra do Safari.
              </li>
              <li>
                Role para baixo e selecione{" "}
                <span className="inline-flex items-center gap-1 text-slate-200 font-medium">
                  <PlusSquare className="w-3 h-3 text-emerald-400 inline" /> Adicionar à Tela de Início
                </span>.
              </li>
            </ol>
          </div>
        )}
      </div>
    </aside>
  );
}
