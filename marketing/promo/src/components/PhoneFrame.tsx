import type { ReactNode } from "react";

/** A phone: rounded bezel, the clip inside. */
export const PhoneFrame = ({ width, children }: { width: number; children: ReactNode }) => {
  const bezel = 14;
  return (
    <div style={{ width: width + bezel * 2, padding: bezel, borderRadius: 60, background: "#0d1512", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 40px 100px rgba(0,0,0,0.6)", position: "relative" }}>
      <div style={{ borderRadius: 48, overflow: "hidden", lineHeight: 0, background: "#fff" }}>{children}</div>
    </div>
  );
};
