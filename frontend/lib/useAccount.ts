"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchAccount } from "./api";
import type { AccountSummary } from "./types";

export function useAccount(enabled: boolean) {
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      return;
    }
    try {
      const result = await fetchAccount();
      setAccount(result);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load account");
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    fetchAccount()
      .then((result) => {
        if (!cancelled) {
          setAccount(result);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(
            caught instanceof Error ? caught.message : "Failed to load account"
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { account: enabled ? account : null, error, refresh };
}