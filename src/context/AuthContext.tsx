import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from "react";
import { useRouter } from "next/router";

export const AUTH_USER_STORAGE_KEY = "wattflow_auth_user_v1";

export interface AuthUser {
  id: string;
  email: string;
  fullName?: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  logout: async () => {},
  refreshUser: async () => {},
});

const PUBLIC_ROUTES = ["/login", "/register"];
const VISIBILITY_REVALIDATE_THROTTLE_MS = 30_000;

function readCachedAuthUser(): AuthUser | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(AUTH_USER_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.id !== "string" ||
      candidate.id.trim().length === 0 ||
      typeof candidate.email !== "string" ||
      candidate.email.trim().length === 0
    ) {
      return null;
    }

    return {
      id: candidate.id,
      email: candidate.email,
      fullName: typeof candidate.fullName === "string" ? candidate.fullName : null,
    };
  } catch {
    return null;
  }
}

function writeCachedAuthUser(authUser: AuthUser): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const safeUser: AuthUser = {
      id: authUser.id,
      email: authUser.email,
      fullName: authUser.fullName ?? null,
    };
    window.localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(safeUser));
  } catch {
    // Ignora falhas de cota ou modo privado no navegador
  }
}

function clearCachedAuthUser(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(AUTH_USER_STORAGE_KEY);
  } catch {
    // Ignora falhas de acesso ao localStorage
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const userRef = useRef<AuthUser | null>(null);
  const pathnameRef = useRef<string>(router.pathname);
  const lastRevalidateAtRef = useRef<number>(0);

  useEffect(() => {
    pathnameRef.current = router.pathname;
  }, [router.pathname]);

  const fetchSession = useCallback(async () => {
    lastRevalidateAtRef.current = Date.now();
    try {
      const response = await fetch("/api/auth/me", {
        credentials: "same-origin",
        cache: "no-store",
      });

      if (response.status === 401) {
        clearCachedAuthUser();
        userRef.current = null;
        setUser(null);
        if (!PUBLIC_ROUTES.includes(pathnameRef.current)) {
          router.replace("/login");
        }
        return;
      }

      if (!response.ok) {
        // Erros HTTP >= 500 ou transientes preservam sessao/cache em memoria
        const hasPersistedState = Boolean(userRef.current || readCachedAuthUser());
        if (!hasPersistedState && !PUBLIC_ROUTES.includes(pathnameRef.current)) {
          router.replace("/login");
        }
        return;
      }

      const data = (await response.json()) as {
        isAuthenticated?: boolean;
        user?: AuthUser;
      };

      if (data.isAuthenticated && data.user) {
        const sanitizedUser: AuthUser = {
          id: data.user.id,
          email: data.user.email,
          fullName: data.user.fullName ?? null,
        };
        writeCachedAuthUser(sanitizedUser);
        userRef.current = sanitizedUser;
        setUser(sanitizedUser);
        return;
      }

      if (data.isAuthenticated === false) {
        clearCachedAuthUser();
        userRef.current = null;
        setUser(null);
        if (!PUBLIC_ROUTES.includes(pathnameRef.current)) {
          router.replace("/login");
        }
      }
    } catch {
      // Falha de rede / modo offline preserva cache local e nao derruba o usuario
      const hasPersistedState = Boolean(userRef.current || readCachedAuthUser());
      if (!hasPersistedState && !PUBLIC_ROUTES.includes(pathnameRef.current)) {
        router.replace("/login");
      }
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const cachedUser = readCachedAuthUser();
    if (cachedUser) {
      userRef.current = cachedUser;
      setUser(cachedUser);
      setIsLoading(false);
    }

    fetchSession();

    const handleOnline = () => {
      fetchSession();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      const elapsedSinceLastCheck = Date.now() - lastRevalidateAtRef.current;
      if (elapsedSinceLastCheck >= VISIBILITY_REVALIDATE_THROTTLE_MS) {
        fetchSession();
      }
    };

    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchSession]);

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } finally {
      clearCachedAuthUser();
      userRef.current = null;
      setUser(null);
      router.replace("/login");
    }
  };

  const refreshUser = async () => {
    await fetchSession();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: Boolean(user),
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
