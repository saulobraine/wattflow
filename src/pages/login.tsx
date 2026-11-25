import React, { useState, FormEvent } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { Zap, Lock, Mail, AlertCircle, ArrowRight, ShieldCheck, ArrowLeft } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { toast } from "../hooks/use-toast";
import { TransitionLink } from "../components/TransitionLink";
import { transitionNavigate } from "../utils/transitionNavigate";

export default function LoginPage() {
  const router = useRouter();
  const { refreshUser } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [totpToken, setTotpToken] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, rememberMe }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        if (response.status === 429) {
          const message =
            data.message || "Muitas tentativas de login. Aguarde alguns instantes e tente novamente.";
          setErrorMessage(message);
          toast({ title: "Muitas tentativas", description: message, variant: "destructive" });
          return;
        }
        const message = data.message || "Credenciais inválidas.";
        setErrorMessage(message);
        toast({ title: "Falha no login", description: message, variant: "destructive" });
        return;
      }

      if (data.requiresTwoFactor && data.challengeToken) {
        setChallengeToken(data.challengeToken);
        setTotpToken("");
        toast({
          title: "Verificação 2FA",
          description: "Informe o código TOTP de 6 dígitos do seu autenticador.",
          variant: "default",
        });
        return;
      }

      toast({
        title: "Login realizado",
        description: "Bem-vindo de volta ao WattFlow.",
        variant: "success",
      });
      await refreshUser();
      transitionNavigate(router, "/");
    } catch {
      const message = "Erro ao conectar com o servidor.";
      setErrorMessage(message);
      toast({ title: "Erro de conexão", description: message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleTwoFactorSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!challengeToken) return;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/auth/login-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeToken,
          token: totpToken,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        if (response.status === 429) {
          const message =
            data.message || "Muitas tentativas de verificação. Aguarde alguns instantes e tente novamente.";
          setErrorMessage(message);
          toast({ title: "Muitas tentativas", description: message, variant: "destructive" });
          return;
        }
        const message = data.message || "Código 2FA inválido ou expirado.";
        setErrorMessage(message);
        toast({ title: "Falha na verificação 2FA", description: message, variant: "destructive" });
        return;
      }

      toast({
        title: "Autenticação confirmada",
        description: "Verificação em duas etapas concluída com sucesso.",
        variant: "success",
      });
      await refreshUser();
      transitionNavigate(router, "/");
    } catch {
      const message = "Erro ao validar o código de autenticação.";
      setErrorMessage(message);
      toast({ title: "Erro de conexão", description: message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackToLogin = () => {
    setChallengeToken(null);
    setTotpToken("");
    setErrorMessage(null);
  };

  return (
    <>
      <Head>
        <title>Entrar na Conta | WattFlow</title>
      </Head>
      <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center px-4 py-8 sm:py-12 animate-fade-in overflow-x-hidden">
        <div className="w-full max-w-md space-y-8 animate-card stagger-1">
          <div className="text-center space-y-2">
            <div className="inline-flex p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 mb-2 shadow-lg shadow-emerald-950/40 animate-float">
              <Zap className="w-8 h-8" aria-hidden="true" />
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">
              WattFlow
            </h1>
            <p className="text-sm text-slate-400">
              Acesse sua conta para gerenciar seu orquestrador de energia
            </p>
          </div>

          <div className="p-5 sm:p-8 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl space-y-6 interactive-card">
            {errorMessage && (
              <div
                role="alert"
                aria-live="polite"
                className="animate-alert p-4 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-300 flex items-center gap-3 text-sm shadow-md shadow-rose-950/20"
              >
                <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" aria-hidden="true" />
                <span>{errorMessage}</span>
              </div>
            )}

            {challengeToken ? (
              <form onSubmit={handleTwoFactorSubmit} className="space-y-4">
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="space-y-0.5">
                    <div className="text-xs font-semibold text-emerald-300">
                      Verificação em Duas Etapas (2FA)
                    </div>
                    <p className="text-xs text-slate-300">
                      Informe o código TOTP de 6 dígitos gerado pelo seu aplicativo autenticador.
                    </p>
                  </div>
                </div>

                <div>
                  <label htmlFor="login-totp-input" className="block text-xs font-semibold text-slate-300 uppercase mb-1">
                    Código TOTP (6 dígitos)
                  </label>
                  <input
                    id="login-totp-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    autoFocus
                    value={totpToken}
                    onChange={(e) => setTotpToken(e.target.value.replace(/\D/g, ""))}
                    placeholder="000000"
                    className="w-full px-4 py-3 min-h-[44px] rounded-xl bg-slate-950 border border-slate-700 text-slate-100 text-center font-mono text-xl tracking-[0.25em] sm:tracking-[0.35em] focus:border-emerald-500 focus:outline-none transition-colors"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading || totpToken.length !== 6}
                  aria-label="Verificar código 2FA e entrar"
                  className="w-full py-3 px-4 min-h-[44px] rounded-xl font-semibold text-sm bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white transition-all duration-150 shadow-lg shadow-emerald-950 flex items-center justify-center gap-2 disabled:opacity-50 mt-2 cursor-pointer disabled:cursor-not-allowed group"
                >
                  <span>{isLoading ? "Verificando..." : "Verificar e Entrar"}</span>
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </button>

                <button
                  type="button"
                  onClick={handleBackToLogin}
                  disabled={isLoading}
                  className="w-full py-2.5 px-3 min-h-[44px] rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Voltar ao login</span>
                </button>
              </form>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="login-email-input" className="block text-xs font-semibold text-slate-300 uppercase mb-1">
                    E-mail
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3.5 transition-colors" aria-hidden="true" />
                    <input
                      id="login-email-input"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="seu@email.com"
                      className="w-full pl-9 pr-3 py-2.5 min-h-[44px] rounded-xl bg-slate-950 border border-slate-700 text-slate-100 text-base sm:text-sm focus:border-emerald-500 focus:outline-none transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="login-password-input" className="block text-xs font-semibold text-slate-300 uppercase mb-1">
                    Senha
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3.5 transition-colors" aria-hidden="true" />
                    <input
                      id="login-password-input"
                      type="password"
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-9 pr-3 py-2.5 min-h-[44px] rounded-xl bg-slate-950 border border-slate-700 text-slate-100 text-base sm:text-sm focus:border-emerald-500 focus:outline-none transition-colors"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <label htmlFor="login-remember-me" className="flex items-center gap-2.5 cursor-pointer select-none group min-h-[32px]">
                    <input
                      id="login-remember-me"
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-emerald-500/30 focus:ring-offset-0 focus:ring-2 transition-colors cursor-pointer"
                    />
                    <span className="text-xs text-slate-300 group-hover:text-slate-200 transition-colors">
                      Manter conectado por 30 dias
                    </span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  aria-label="Entrar no WattFlow"
                  className="w-full py-3 px-4 min-h-[44px] rounded-xl font-semibold text-sm bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white transition-all duration-150 shadow-lg shadow-emerald-950 flex items-center justify-center gap-2 disabled:opacity-50 mt-2 cursor-pointer disabled:cursor-not-allowed group"
                >
                  <span>{isLoading ? "Entrando..." : "Entrar no WattFlow"}</span>
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </button>
              </form>
            )}

            <div className="border-t border-slate-800 pt-4 text-center text-xs text-slate-400">
              Ainda não possui uma conta?{" "}
              <TransitionLink href="/register" className="font-semibold text-emerald-400 hover:text-emerald-300 underline transition-colors">
                Criar Conta (BYOK)
              </TransitionLink>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
