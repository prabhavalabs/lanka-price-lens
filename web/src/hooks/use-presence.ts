import { useEffect, useState } from "react";

/**
 * How many people are on the site right now. Each tab keeps a random id for its lifetime and beats
 * once a minute while visible; the API counts beats from the last three minutes. No cookies, nothing
 * that identifies a person.
 */
export function usePresence(): number | null {
  const [online, setOnline] = useState<number | null>(null);
  useEffect(() => {
    let id: string;
    try {
      id = window.sessionStorage.getItem("pricelens.presence") ?? "";
      if (!id) {
        id = crypto.randomUUID();
        window.sessionStorage.setItem("pricelens.presence", id);
      }
    } catch {
      id = crypto.randomUUID();
    }
    let cancelled = false;
    const beat = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch("/v1/public/presence", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
        const body = (await response.json()) as { payload?: { online?: number } };
        if (!cancelled && typeof body.payload?.online === "number") setOnline(body.payload.online);
      } catch {
        // Offline or blocked: the count simply stays as it was.
      }
    };
    void beat();
    const timer = setInterval(() => void beat(), 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") void beat(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return online;
}
