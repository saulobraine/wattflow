import React, { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { useAuth } from "../context/AuthContext";
import {
  User,
  Mail,
  Key,
  ShieldCheck,
  Fingerprint,
  Lock,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Plus,
  Copy,
  Check,
  Eye,
  EyeOff,
  Smartphone,
  Loader2,
  ShieldAlert,
  Save,
  QrCode,
} from "lucide-react";

interface PasskeyItem {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface ProfileData {
  id: string;
  email: string;
  fullName: string | null;
  twoFactorEnabled: boolean;
  createdAt: string;
  passkeysCount: number;
  passkeys: PasskeyItem[];
}

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();

  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

  // Form Dados Pessoais
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [profileCurrentPassword, setProfileCurrentPassword] = useState("");
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const isEmailChanged = Boolean(
    profileData && email.trim().toLowerCase() !== profileData.email.trim().toLowerCase()
  );

  // Form Troca de Senha
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // 2FA State
  const [isSettingUp2FA, setIsSettingUp2FA] = useState(false);
  const [totpSecret, setTotpSecret] = useState("");
  const [totpToken, setTotpToken] = useState("");
  const [enableTwoFactorPassword, setEnableTwoFactorPassword] = useState("");
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [isVerifying2FA, setIsVerifying2FA] = useState(false);
  const [twoFactorFeedback, setTwoFactorFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [disablePassword, setDisablePassword] = useState("");
  const [isDisabling2FA, setIsDisabling2FA] = useState(false);
  const [showDisableModal, setShowDisableModal] = useState(false);

  // Passkey State
  const [isPasskeySupported, setIsPasskeySupported] = useState(false);
  const [passkeyName, setPasskeyName] = useState("");
  const [isCreatingPasskey, setIsCreatingPasskey] = useState(false);
  const [passkeyFeedback, setPasskeyFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [deletingPasskeyId, setDeletingPasskeyId] = useState<string | null>(null);

  const fetchProfile = async () => {
    try {
      const response = await fetch("/api/auth/profile");
      const json = await response.json();
      if (json.success && json.data) {
        setProfileData(json.data);
        setFullName(json.data.fullName || "");
        setEmail(json.data.email || "");
      }
    } catch (err) {
      console.error("Erro ao carregar dados do perfil:", err);
    } finally {
      setIsLoadingProfile(false);
    }
  };

  useEffect(() => {
    fetchProfile();
    if (typeof window !== "undefined" && window.PublicKeyCredential) {
      setIsPasskeySupported(true);
    }
  }, []);

  // Atualizar dados de Perfil (Nome e E-mail)
  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileFeedback(null);

    if (isEmailChanged && !profileCurrentPassword) {
      setProfileFeedback({
        type: "error",
        message: "Informe sua senha atual para confirmar a alteração do endereço de e-mail.",
      });
      return;
    }

    setIsUpdatingProfile(true);

    try {
      const response = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          email,
          ...(isEmailChanged ? { currentPassword: profileCurrentPassword } : {}),
        }),
      });
      const result = await response.json();

      if (response.ok && result.success) {
        setProfileFeedback({ type: "success", message: result.message });
        setProfileCurrentPassword("");
        await refreshUser();
        await fetchProfile();
      } else {
        setProfileFeedback({ type: "error", message: result.message || "Falha ao atualizar perfil." });
      }
    } catch {
      setProfileFeedback({ type: "error", message: "Erro de rede ao conectar com o servidor." });
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  // Trocar Senha
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordFeedback(null);

    if (newPassword.length < 12 || newPassword.length > 128) {
      setPasswordFeedback({ type: "error", message: "A nova senha deve possuir entre 12 e 128 caracteres." });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordFeedback({ type: "error", message: "A confirmação da nova senha não coincide." });
      return;
    }

    setIsChangingPassword(true);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const result = await response.json();

      if (result.success) {
        setPasswordFeedback({ type: "success", message: result.message });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setPasswordFeedback({ type: "error", message: result.message || "Erro ao alterar senha." });
      }
    } catch {
      setPasswordFeedback({ type: "error", message: "Erro de conexão ao alterar a senha." });
    } finally {
      setIsChangingPassword(false);
    }
  };

  // Iniciar Configuração de 2FA
  const handleStart2FASetup = async () => {
    setTwoFactorFeedback(null);
    try {
      const response = await fetch("/api/auth/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SETUP" }),
      });
      const result = await response.json();
      if (result.success && result.data?.secret) {
        setTotpSecret(result.data.secret);
        setQrCodeUrl(result.data.qrCodeDataUrl || "");
        setIsSettingUp2FA(true);
        setTotpToken("");
        setEnableTwoFactorPassword("");
      } else {
        setTwoFactorFeedback({ type: "error", message: result.message || "Falha ao gerar segredo 2FA." });
      }
    } catch {
      setTwoFactorFeedback({ type: "error", message: "Erro ao comunicar com o servidor de 2FA." });
    }
  };

  // Confirmar e Ativar 2FA com token de 6 dígitos
  const handleVerifyAndEnable2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setTwoFactorFeedback(null);
    setIsVerifying2FA(true);

    try {
      const response = await fetch("/api/auth/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "VERIFY_AND_ENABLE",
          token: totpToken,
          currentPassword: enableTwoFactorPassword,
        }),
      });
      const result = await response.json();

      if (result.success) {
        setTwoFactorFeedback({ type: "success", message: result.message });
        setIsSettingUp2FA(false);
        setTotpSecret("");
        setQrCodeUrl("");
        setTotpToken("");
        setEnableTwoFactorPassword("");
        await fetchProfile();
      } else {
        setTwoFactorFeedback({ type: "error", message: result.message || "Código inválido." });
      }
    } catch {
      setTwoFactorFeedback({ type: "error", message: "Erro ao validar código de autenticação." });
    } finally {
      setIsVerifying2FA(false);
    }
  };

  // Desativar 2FA com confirmação de senha
  const handleDisable2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsDisabling2FA(true);
    setTwoFactorFeedback(null);

    try {
      const response = await fetch("/api/auth/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "DISABLE",
          currentPassword: disablePassword,
        }),
      });
      const result = await response.json();

      if (result.success) {
        setTwoFactorFeedback({ type: "success", message: result.message });
        setShowDisableModal(false);
        setDisablePassword("");
        await fetchProfile();
      } else {
        setTwoFactorFeedback({ type: "error", message: result.message || "Senha incorreta." });
      }
    } catch {
      setTwoFactorFeedback({ type: "error", message: "Erro de conexão ao desativar o 2FA." });
    } finally {
      setIsDisabling2FA(false);
    }
  };

  // Criar Passkey nativa WebAuthn
  const handleCreatePasskey = async () => {
    if (!isPasskeySupported) {
      setPasskeyFeedback({
        type: "error",
        message: "Seu navegador ou dispositivo atual não possui suporte a chaves biométricas WebAuthn.",
      });
      return;
    }

    setIsCreatingPasskey(true);
    setPasskeyFeedback(null);

    try {
      // 1. Obter desafio do servidor
      const challengeRes = await fetch("/api/auth/passkey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CHALLENGE" }),
      });
      const challengeJson = await challengeRes.json();

      if (!challengeJson.success || !challengeJson.data?.challenge) {
        throw new Error(challengeJson.message || "Falha ao gerar desafio WebAuthn.");
      }

      const { challenge, userId, userEmail, userName } = challengeJson.data;

      // Converte o desafio e o userId de base64url para Uint8Array
      const challengeBuffer = Uint8Array.from(atob(challenge.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
        c.charCodeAt(0)
      );
      const userBuffer = Uint8Array.from(userId, (c: string) => c.charCodeAt(0));

      // 2. Chamar a API nativa do navegador
      const credential = (await navigator.credentials.create({
        publicKey: {
          challenge: challengeBuffer,
          rp: {
            name: "WattFlow Orquestrador",
            id: window.location.hostname,
          },
          user: {
            id: userBuffer,
            name: userEmail,
            displayName: userName || userEmail,
          },
          pubKeyCredParams: [
            { alg: -7, type: "public-key" }, // ES256
            { alg: -257, type: "public-key" }, // RS256
          ],
          authenticatorSelection: {
            residentKey: "preferred",
            userVerification: "preferred",
          },
          timeout: 60000,
          attestation: "none",
        },
      })) as PublicKeyCredential | null;

      if (!credential) {
        throw new Error("O registro biométrico foi cancelado.");
      }

      const responseAttestation = credential.response as AuthenticatorAttestationResponse;
      const rawIdBase64 = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      const publicKeyBase64 = btoa(
        String.fromCharCode(...new Uint8Array(responseAttestation.attestationObject))
      );

      // 3. Salvar no servidor
      const registerRes = await fetch("/api/auth/passkey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "REGISTER",
          credentialId: rawIdBase64,
          publicKey: publicKeyBase64,
          name: passkeyName.trim() || undefined,
        }),
      });
      const registerResult = await registerRes.json();

      if (registerResult.success) {
        setPasskeyFeedback({ type: "success", message: registerResult.message });
        setPasskeyName("");
        await fetchProfile();
      } else {
        setPasskeyFeedback({ type: "error", message: registerResult.message || "Erro ao registrar chave." });
      }
    } catch (err: unknown) {
      console.error("Erro no fluxo de passkey:", err);
      const msg = err instanceof Error ? err.message : "Ocorreu um erro ao criar a chave de acesso.";
      setPasskeyFeedback({ type: "error", message: msg });
    } finally {
      setIsCreatingPasskey(false);
    }
  };

  // Excluir Passkey
  const handleDeletePasskey = async (passkeyId: string) => {
    setDeletingPasskeyId(passkeyId);
    setPasskeyFeedback(null);

    try {
      const response = await fetch("/api/auth/passkey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "DELETE", passkeyId }),
      });
      const result = await response.json();

      if (result.success) {
        setPasskeyFeedback({ type: "success", message: result.message });
        await fetchProfile();
      } else {
        setPasskeyFeedback({ type: "error", message: result.message || "Erro ao excluir chave." });
      }
    } catch {
      setPasskeyFeedback({ type: "error", message: "Erro de conexão ao remover passkey." });
    } finally {
      setDeletingPasskeyId(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  return (
    <Layout title="Perfil e Segurança">
      <div className="space-y-8">
        {/* Cabeçalho de Boas-vindas da Conta */}
        <div className="animate-card stagger-1 interactive-card flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/80 p-4 sm:p-6 rounded-2xl border border-slate-800 shadow-xl backdrop-blur">
          <div className="flex items-center gap-3.5 sm:gap-4">
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center text-slate-950 font-bold text-xl sm:text-2xl shadow-lg shadow-emerald-950/40 shrink-0">
              {(fullName || user?.email || "U").charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-bold text-slate-100 flex items-center gap-2 truncate">
                {fullName || "Usuário WattFlow"}
              </h2>
              <p className="text-xs text-slate-400 font-mono mt-0.5 truncate">{email || user?.email}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${
                profileData?.twoFactorEnabled
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                  : "bg-amber-500/15 text-amber-300 border-amber-500/30"
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
              {profileData?.twoFactorEnabled ? "2FA Ativo" : "2FA Desativado"}
            </span>

            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
              <Fingerprint className="w-3.5 h-3.5 text-teal-400" aria-hidden="true" />
              {profileData?.passkeysCount ?? 0} Passkeys
            </span>
          </div>
        </div>

        {/* Grade Responsiva em 2 Colunas */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          {/* Coluna 1: Dados Pessoais & Senha */}
          <div className="space-y-8">
            {/* 1. Card de Dados Pessoais e Troca de E-mail */}
            <section className="animate-card stagger-2 interactive-card bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl space-y-5">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <User className="w-5 h-5 text-emerald-400" aria-hidden="true" />
                <h3 className="font-bold text-slate-100 text-base">Dados Pessoais e E-mail</h3>
              </div>

              {profileFeedback && (
                <div
                  role="alert"
                  aria-live="polite"
                  className={`p-3.5 rounded-xl border text-xs font-medium flex items-center gap-2 ${
                    profileFeedback.type === "success"
                      ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-300"
                      : "bg-rose-950/60 border-rose-500/40 text-rose-300"
                  }`}
                >
                  {profileFeedback.type === "success" ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" aria-hidden="true" />
                  )}
                  <span>{profileFeedback.message}</span>
                </div>
              )}

              <form onSubmit={handleUpdateProfile} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="profile-fullname" className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                    Nome Completo
                  </label>
                  <input
                    id="profile-fullname"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Seu nome"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 min-h-[44px] text-base sm:text-sm text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="profile-email" className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                    Endereço de E-mail
                  </label>
                  <input
                    id="profile-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (profileData && e.target.value.trim().toLowerCase() === profileData.email.trim().toLowerCase()) {
                        setProfileCurrentPassword("");
                      }
                    }}
                    placeholder="seu@email.com"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 min-h-[44px] text-base sm:text-sm text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors font-mono"
                  />
                </div>

                {isEmailChanged && (
                  <div className="space-y-1.5 p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/30">
                    <label htmlFor="profile-current-password" className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                      Senha atual (obrigatória para alterar o e-mail)
                    </label>
                    <input
                      id="profile-current-password"
                      type="password"
                      required
                      autoComplete="current-password"
                      value={profileCurrentPassword}
                      onChange={(e) => setProfileCurrentPassword(e.target.value)}
                      placeholder="Digite sua senha atual"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 min-h-[44px] text-base sm:text-sm text-slate-200 focus:outline-none focus:border-amber-400 transition-colors"
                    />
                  </div>
                )}

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={isUpdatingProfile || (isEmailChanged && !profileCurrentPassword)}
                    className="w-full sm:w-auto px-5 py-2.5 min-h-[44px] rounded-xl font-semibold text-xs bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isUpdatingProfile ? (
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Save className="w-4 h-4" aria-hidden="true" />
                    )}
                    {isUpdatingProfile ? "Salvando..." : "Salvar Alterações"}
                  </button>
                </div>
              </form>
            </section>

            {/* 2. Card de Alteração de Senha */}
            <section className="animate-card stagger-3 interactive-card bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl space-y-5">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <Lock className="w-5 h-5 text-amber-400" aria-hidden="true" />
                <h3 className="font-bold text-slate-100 text-base">Segurança &amp; Alteração de Senha</h3>
              </div>

              {passwordFeedback && (
                <div
                  role="alert"
                  aria-live="polite"
                  className={`p-3.5 rounded-xl border text-xs font-medium flex items-center gap-2 ${
                    passwordFeedback.type === "success"
                      ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-300"
                      : "bg-rose-950/60 border-rose-500/40 text-rose-300"
                  }`}
                >
                  {passwordFeedback.type === "success" ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" aria-hidden="true" />
                  )}
                  <span>{passwordFeedback.message}</span>
                </div>
              )}

              <form onSubmit={handleChangePassword} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="current-password-input" className="text-xs font-semibold text-slate-300">
                    Senha Atual
                  </label>
                  <div className="relative">
                    <input
                      id="current-password-input"
                      type={showCurrentPassword ? "text" : "password"}
                      required
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Digite sua senha atual"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 min-h-[44px] pr-10 text-base sm:text-sm text-slate-200 focus:outline-none focus:border-amber-400 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword((prev) => !prev)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-2 min-w-[40px] min-h-[40px] flex items-center justify-center cursor-pointer"
                    >
                      {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="new-password-input" className="text-xs font-semibold text-slate-300">
                    Nova Senha (12 a 128 caracteres)
                  </label>
                  <div className="relative">
                    <input
                      id="new-password-input"
                      type={showNewPassword ? "text" : "password"}
                      required
                      minLength={12}
                      maxLength={128}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Entre 12 e 128 caracteres"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 min-h-[44px] pr-10 text-base sm:text-sm text-slate-200 focus:outline-none focus:border-amber-400 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((prev) => !prev)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-2 min-w-[40px] min-h-[40px] flex items-center justify-center cursor-pointer"
                    >
                      {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="confirm-password-input" className="text-xs font-semibold text-slate-300">
                    Confirmar Nova Senha
                  </label>
                  <input
                    id="confirm-password-input"
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repita a nova senha"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 min-h-[44px] text-base sm:text-sm text-slate-200 focus:outline-none focus:border-amber-400 transition-colors"
                  />
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={isChangingPassword || !currentPassword || !newPassword}
                    className="w-full sm:w-auto px-5 py-2.5 min-h-[44px] rounded-xl font-semibold text-xs bg-amber-600 hover:bg-amber-500 active:scale-95 text-white transition-all flex items-center justify-center gap-2 shadow-lg shadow-amber-950/40 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isChangingPassword ? (
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Key className="w-4 h-4" aria-hidden="true" />
                    )}
                    {isChangingPassword ? "Alterando..." : "Atualizar Senha"}
                  </button>
                </div>
              </form>
            </section>
          </div>

          {/* Coluna 2: Fatores de Autenticação (2FA & Passkeys) */}
          <div className="space-y-8">
            {/* 3. Card de Autenticação em Duas Etapas (2FA / TOTP) */}
            <section className="animate-card stagger-4 interactive-card bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Smartphone className="w-5 h-5 text-indigo-400" aria-hidden="true" />
                  <h3 className="font-bold text-slate-100 text-base">Autenticação em Duas Etapas (2FA / TOTP)</h3>
                </div>
                <span
                  className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${
                    profileData?.twoFactorEnabled
                      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                      : "bg-slate-800 text-slate-400 border-slate-700"
                  }`}
                >
                  {profileData?.twoFactorEnabled ? "ATIVADO" : "DESATIVADO"}
                </span>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed">
                Proteja sua conta exigindo um código gerado pelo seu aplicativo autenticador (Google Authenticator, Microsoft Authenticator, 1Password ou Authy) a cada início de sessão.
              </p>

              {twoFactorFeedback && (
                <div
                  role="alert"
                  aria-live="polite"
                  className={`p-3.5 rounded-xl border text-xs font-medium flex items-center gap-2 ${
                    twoFactorFeedback.type === "success"
                      ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-300"
                      : "bg-rose-950/60 border-rose-500/40 text-rose-300"
                  }`}
                >
                  {twoFactorFeedback.type === "success" ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" aria-hidden="true" />
                  )}
                  <span>{twoFactorFeedback.message}</span>
                </div>
              )}

              {!profileData?.twoFactorEnabled ? (
                <div>
                  {!isSettingUp2FA ? (
                    <button
                      type="button"
                      onClick={handleStart2FASetup}
                      className="w-full sm:w-auto px-5 py-2.5 rounded-xl font-semibold text-xs bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-950/40 cursor-pointer"
                    >
                      <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                      Configurar Autenticação em 2 Etapas
                    </button>
                  ) : (
                    <div className="p-4 sm:p-6 rounded-2xl bg-slate-950/80 border border-indigo-900/40 space-y-6 animate-in fade-in-0 shadow-2xl overflow-hidden">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                        <div className="space-y-0.5">
                          <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                            <QrCode className="w-4 h-4 text-indigo-400" aria-hidden="true" />
                            Configurar Aplicativo Autenticador
                          </h4>
                          <p className="text-xs text-slate-400">
                            Sincronize sua conta com o Google Authenticator, Microsoft Authenticator, 1Password ou Authy.
                          </p>
                        </div>
                      </div>

                      {/* Bloco Central: QR Code + Entrada Manual */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start min-w-0">
                        {/* Imagem do QR Code em Card Branco de Alto Contraste */}
                        <div className="flex flex-col items-center justify-center p-4 bg-slate-900/90 rounded-2xl border border-slate-800 text-center gap-2.5 min-w-0">
                          {qrCodeUrl ? (
                            <div className="p-2.5 bg-white rounded-xl shadow-lg shadow-black/50 border border-slate-200">
                              <img
                                src={qrCodeUrl}
                                alt="QR Code de Autenticação 2FA"
                                width={160}
                                height={160}
                                className="w-36 h-36 sm:w-44 sm:h-44 block object-contain"
                              />
                            </div>
                          ) : (
                            <div className="w-36 h-36 sm:w-44 sm:h-44 bg-slate-800 rounded-xl flex items-center justify-center text-slate-500 text-xs">
                              <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
                            </div>
                          )}
                          <span className="text-[11px] text-slate-400 font-medium">
                            Aponte a câmera do seu app para o QR Code
                          </span>
                        </div>

                        {/* Chave de Configuração Manual */}
                        <div className="space-y-4 min-w-0">
                          <div className="space-y-1.5">
                            <span className="text-xs font-semibold text-slate-300 block">
                              Ou insira a chave secreta manualmente:
                            </span>
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 bg-slate-900 p-2.5 rounded-xl border border-slate-800 min-w-0">
                              <span className="font-mono text-indigo-300 font-bold tracking-wider text-xs flex-1 break-all select-all min-w-0 px-1 py-1">
                                {totpSecret}
                              </span>
                              <button
                                type="button"
                                onClick={() => copyToClipboard(totpSecret)}
                                aria-label="Copiar chave secreta"
                                className="flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer shrink-0 min-h-[40px] sm:min-h-0"
                              >
                                {copiedSecret ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                    <span>Copiado</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5" />
                                    <span>Copiar</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>

                          {/* Verificação do Código de 6 dígitos */}
                          <form onSubmit={handleVerifyAndEnable2FA} className="space-y-3 pt-3 border-t border-slate-800/80 min-w-0">
                            <label htmlFor="totp-code-input" className="text-xs font-semibold text-slate-300 block">
                              Digite o código de 6 dígitos gerado:
                            </label>
                            <div className="flex flex-col gap-2.5">
                              <input
                                id="totp-code-input"
                                type="text"
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                maxLength={6}
                                required
                                value={totpToken}
                                onChange={(e) => setTotpToken(e.target.value.replace(/\D/g, ""))}
                                placeholder="000000"
                                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 min-h-[44px] text-center font-mono text-lg tracking-widest text-slate-100 focus:outline-none focus:border-indigo-400 transition-colors"
                              />
                              <div className="space-y-1">
                                <label htmlFor="totp-current-password-input" className="text-xs font-semibold text-slate-300 block">
                                  Confirme sua senha atual para ativar o 2FA:
                                </label>
                                <input
                                  id="totp-current-password-input"
                                  type="password"
                                  required
                                  autoComplete="current-password"
                                  value={enableTwoFactorPassword}
                                  onChange={(e) => setEnableTwoFactorPassword(e.target.value)}
                                  placeholder="Sua senha atual"
                                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 min-h-[44px] text-base sm:text-sm text-slate-100 focus:outline-none focus:border-indigo-400 transition-colors"
                                />
                              </div>
                              <button
                                type="submit"
                                disabled={isVerifying2FA || totpToken.length !== 6 || !enableTwoFactorPassword}
                                className="w-full px-5 py-2.5 min-h-[44px] rounded-xl font-semibold text-xs bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                {isVerifying2FA ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="w-4 h-4" />
                                )}
                                Ativar 2FA
                              </button>
                            </div>
                            <div className="flex justify-center pt-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setIsSettingUp2FA(false);
                                  setQrCodeUrl("");
                                  setTotpSecret("");
                                  setTotpToken("");
                                  setEnableTwoFactorPassword("");
                                }}
                                className="text-xs text-slate-400 hover:text-slate-200 transition-colors cursor-pointer py-1"
                              >
                                Cancelar configuração
                              </button>
                            </div>
                          </form>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                      <ShieldCheck className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-200">Sua conta está protegida por 2FA</div>
                      <div className="text-[11px] text-slate-400">Códigos TOTP temporários são solicitados em novos logins.</div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowDisableModal(true)}
                    className="w-full sm:w-auto px-4 py-2 rounded-xl font-semibold text-xs text-rose-400 hover:bg-rose-500/10 border border-rose-500/30 active:scale-95 transition-all cursor-pointer text-center"
                  >
                    Desativar 2FA
                  </button>
                </div>
              )}
            </section>

            {/* 4. Card de Passkeys (Biometria / WebAuthn) */}
            <section className="animate-card stagger-5 interactive-card bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Fingerprint className="w-5 h-5 text-teal-400" aria-hidden="true" />
                  <h3 className="font-bold text-slate-100 text-base">Chaves de Acesso (Passkeys / Biometria)</h3>
                </div>
                <span className="text-xs text-slate-400">FIDO2 / WebAuthn</span>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed">
                As Passkeys substituem a digitação de senhas por biometria rápida e segura (Touch ID, Face ID, Windows Hello ou chave física USB).
              </p>

              {passkeyFeedback && (
                <div
                  role="alert"
                  aria-live="polite"
                  className={`p-3.5 rounded-xl border text-xs font-medium flex items-center gap-2 ${
                    passkeyFeedback.type === "success"
                      ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-300"
                      : "bg-rose-950/60 border-rose-500/40 text-rose-300"
                  }`}
                >
                  {passkeyFeedback.type === "success" ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" aria-hidden="true" />
                  )}
                  <span>{passkeyFeedback.message}</span>
                </div>
              )}

              {/* Lista de Passkeys cadastradas */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Suas Chaves Registradas ({profileData?.passkeys?.length ?? 0})
                </h4>

                {!profileData?.passkeys || profileData.passkeys.length === 0 ? (
                  <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-center text-xs text-slate-500">
                    Nenhuma passkey cadastrada ainda nesta conta.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800 rounded-xl bg-slate-950/80 border border-slate-800 overflow-hidden">
                    {profileData.passkeys.map((pk) => (
                      <div key={pk.id} className="p-3.5 flex items-center justify-between gap-3 hover:bg-slate-800/40 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-teal-500/10 border border-teal-500/30 text-teal-400">
                            <Fingerprint className="w-4 h-4" aria-hidden="true" />
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-slate-200">{pk.name}</div>
                            <div className="text-[11px] text-slate-500 font-mono">
                              Criada em: {new Date(pk.createdAt).toLocaleDateString("pt-BR")}
                              {pk.lastUsedAt && ` • Usada em: ${new Date(pk.lastUsedAt).toLocaleDateString("pt-BR")}`}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={deletingPasskeyId === pk.id}
                          onClick={() => handleDeletePasskey(pk.id)}
                          title="Excluir Passkey"
                          aria-label={`Excluir passkey ${pk.name}`}
                          className="p-2 sm:p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer disabled:opacity-40 min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
                        >
                          {deletingPasskeyId === pk.id ? (
                            <Loader2 className="w-4 h-4 animate-spin text-rose-400" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Adicionar Nova Passkey (temporariamente desabilitado até validação FIDO2 completa) */}
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>
                    O cadastro de novas Passkeys está temporariamente desabilitado até a conclusão da validação FIDO2 completa no servidor. Você ainda pode remover chaves já registradas acima.
                  </span>
                </div>
                <div className="p-3.5 sm:p-4 rounded-xl bg-slate-950 border border-slate-800/90 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 opacity-60">
                  <input
                    type="text"
                    disabled
                    value={passkeyName}
                    onChange={(e) => setPasskeyName(e.target.value)}
                    placeholder="Nome da chave (indisponível temporariamente)"
                    className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-base sm:text-xs text-slate-400 focus:outline-none transition-colors flex-1 cursor-not-allowed"
                  />
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    title="Cadastro de novas Passkeys temporariamente desabilitado até validação FIDO2 completa"
                    className="w-full sm:w-auto px-4 py-2.5 rounded-xl font-semibold text-xs bg-teal-600 text-white transition-all flex items-center justify-center gap-2 shadow-lg shadow-teal-950/40 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    Criar Nova Passkey
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* Modal de Desativação de 2FA com Confirmação de Senha */}
      {showDisableModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
        >
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-4 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <ShieldAlert className="w-6 h-6" />
              <h3 className="text-base font-bold text-slate-100">Desativar Autenticação em 2 Etapas</h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Por segurança, digite sua senha atual para confirmar a desativação da proteção 2FA.
            </p>

            <form onSubmit={handleDisable2FA} className="space-y-4">
              <input
                type="password"
                required
                autoFocus
                placeholder="Sua senha atual"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 min-h-[44px] text-base sm:text-sm text-slate-100 focus:outline-none focus:border-rose-400 transition-colors"
              />

              <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowDisableModal(false);
                    setDisablePassword("");
                  }}
                  className="w-full sm:w-auto px-4 py-2.5 min-h-[44px] rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors cursor-pointer text-center flex items-center justify-center"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isDisabling2FA || !disablePassword}
                  className="w-full sm:w-auto px-5 py-2.5 min-h-[44px] rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 active:scale-95 text-white transition-all shadow-md cursor-pointer disabled:opacity-40 text-center flex items-center justify-center"
                >
                  {isDisabling2FA ? "Desativando..." : "Confirmar e Desativar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
