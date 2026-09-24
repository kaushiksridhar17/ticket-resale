"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { fetchMe, signOut } from "./api";
import { applyTheme } from "./theme";
import type { User } from "./types";

interface SessionValue {
  user: User | null;
  loading: boolean;
  setUser: (user: User | null) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const remember = useCallback((next: User | null) => {
    setUser(next);
    if (next) {
      applyTheme(next.theme);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetchMe()
      .then((result) => {
        if (!cancelled) {
          remember(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [remember]);

  const refresh = useCallback(async () => {
    try {
      remember(await fetchMe());
    } catch {
      setUser(null);
    }
  }, [remember]);

  const logout = useCallback(async () => {
    try {
      await signOut();
    } finally {
      setUser(null);
    }
  }, []);

  return (
    <SessionContext.Provider
      value={{ user, loading, setUser: remember, refresh, logout }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSession must be used inside a SessionProvider");
  }
  return value;
}
