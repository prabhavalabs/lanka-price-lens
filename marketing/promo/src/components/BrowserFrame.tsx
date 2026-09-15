import type { ReactNode } from "react";

import { theme } from "../theme";

/** A browser window: title bar with three dots and an address pill, the clip below. */
export const BrowserFrame = ({ url, width, children }: { url: string; width: number; children: ReactNode }) => (
  <div style={{ width, borderRadius: 24, overflow: "hidden", background: theme.chrome, border: "1px solid rgba(255,255,255,0.09)", boxShadow: "0 40px 100px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,0,0,0.5)" }}>
    <div style={{ height: 60, display: "flex", alignItems: "center", padding: "0 24px", gap: 10, fontFamily: theme.font }}>
      {["#ff5f57", "#febc2e", "#28c840"].map((dot) => <span key={dot} style={{ width: 15, height: 15, borderRadius: "50%", background: dot, opacity: 0.9 }} />)}
      <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
        <div style={{ minWidth: 500, padding: "7px 20px", borderRadius: 10, background: "rgba(255,255,255,0.06)", color: theme.muted, fontSize: 20, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <span style={{ width: 11, height: 11, borderRadius: "50%", border: `1.5px solid ${theme.green}` }} />
          {url}
        </div>
      </div>
      <div style={{ width: 65 }} />
    </div>
    <div style={{ display: "block", lineHeight: 0, background: "#fff" }}>{children}</div>
  </div>
);
