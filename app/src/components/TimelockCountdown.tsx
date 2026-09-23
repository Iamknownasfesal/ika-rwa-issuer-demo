"use client";

import { useEffect, useState } from "react";

export function useTimelock(approvedAt: string | undefined, seconds: number) {
  const unlock = approvedAt ? new Date(approvedAt).getTime() + seconds * 1000 : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!unlock || now >= unlock) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [unlock, now]);
  const remaining = unlock ? Math.max(0, Math.ceil((unlock - now) / 1000)) : seconds;
  return { elapsed: !!unlock && now >= unlock, remaining, started: !!unlock };
}
