import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

import { theme } from "../theme";

/** A still, dark ground with a slow green glow drifting behind everything. */
export const Backdrop = () => {
  const frame = useCurrentFrame();
  const drift = interpolate(frame, [0, 1400], [0, 200]);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1600px 900px at ${2000 - drift}px ${-160 + drift * 0.5}px, rgba(61,220,151,0.16), transparent 70%), radial-gradient(1200px 800px at ${260 + drift}px 1460px, rgba(31,138,92,0.14), transparent 70%), ${theme.background}` }}>
      <AbsoluteFill style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)", backgroundSize: "80px 80px", maskImage: "radial-gradient(ellipse at center, black 30%, transparent 85%)" }} />
    </AbsoluteFill>
  );
};
