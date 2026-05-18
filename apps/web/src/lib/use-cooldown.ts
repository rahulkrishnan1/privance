"use client";

import { useCallback, useEffect, useState } from "react";
import { getCooldown } from "@/lib/api/prices";

export function useCooldown(): { cooldownMs: number; refresh: () => void } {
  const [cooldownMs, setCooldownMs] = useState(0);

  const refresh = useCallback(() => {
    getCooldown()
      .then((r) => {
        setCooldownMs(r.msUntilNextRefresh);
      })
      .catch(() => {
        setCooldownMs(0);
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (cooldownMs <= 0) return;
    const id = setInterval(() => {
      setCooldownMs((prev) => {
        const next = prev - 1000;
        return next <= 0 ? 0 : next;
      });
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, [cooldownMs]);

  return { cooldownMs, refresh };
}
