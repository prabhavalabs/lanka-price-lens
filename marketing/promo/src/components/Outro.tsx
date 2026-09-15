import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { theme } from "../theme";
import { Logo } from "./Logo";

const points = ["Free", "No account", "Official sources"];

export const Outro = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 15, stiffness: 110 } });
  const url = spring({ frame: frame - 10, fps, config: { damping: 16, stiffness: 100 } });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontFamily: theme.font }}>
      <div style={{ transform: `scale(${0.8 + pop * 0.2})`, opacity: pop }}>
        <Logo size={118} />
      </div>
      <div style={{ marginTop: 64, padding: "28px 64px", borderRadius: 999, border: `2px solid rgba(61,220,151,0.55)`, background: "rgba(61,220,151,0.08)", color: theme.text, fontSize: 84, fontWeight: 600, letterSpacing: -2, opacity: url, transform: `translateY(${(1 - url) * 20}px)` }}>
        price.prabhavalabs.com
      </div>
      <div style={{ display: "flex", gap: 54, marginTop: 58 }}>
        {points.map((point, index) => {
          const show = interpolate(frame, [22 + index * 6, 34 + index * 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return (
            <div key={point} style={{ display: "flex", alignItems: "center", gap: 16, color: theme.muted, fontSize: 42, opacity: show, transform: `translateY(${(1 - show) * 12}px)` }}>
              <span style={{ width: 13, height: 13, borderRadius: "50%", background: theme.green }} />
              {point}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
