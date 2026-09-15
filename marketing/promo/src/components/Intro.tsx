import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { theme } from "../theme";
import { Logo } from "./Logo";

export const Intro = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 14, stiffness: 120 } });
  const line = spring({ frame: frame - 12, fps, config: { damping: 16, stiffness: 90 } });
  const tag = interpolate(frame, [18, 34], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const exit = interpolate(frame, [durationInFrames - 10, durationInFrames - 1], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontFamily: theme.font, opacity: exit }}>
      <div style={{ transform: `scale(${0.7 + pop * 0.3})`, opacity: pop }}>
        <Logo size={160} />
      </div>
      <div style={{ marginTop: 58, width: 128, height: 5, borderRadius: 2, background: theme.green, transform: `scaleX(${line})`, opacity: line }} />
      <div style={{ marginTop: 48, color: theme.text, fontSize: 72, fontWeight: 500, letterSpacing: -1, opacity: tag, transform: `translateY(${(1 - tag) * 20}px)` }}>
        Sri Lanka food prices, every day
      </div>
      <div style={{ marginTop: 22, color: theme.muted, fontSize: 40, opacity: tag, transform: `translateY(${(1 - tag) * 20}px)` }}>
        Open markets, supermarkets, and wholesale, in one place
      </div>
    </AbsoluteFill>
  );
};
