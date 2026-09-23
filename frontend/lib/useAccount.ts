"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchAccount } from "./api";
import type { AccountSummary } from "./types";

export function useAccount(userId: string) {
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await fetchAccount(userId);
      setAccount(result);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load account");
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { account, error, refresh };
}