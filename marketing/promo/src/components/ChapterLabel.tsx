import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import type { Label } from "../scenes";
import { scenes } from "../scenes";
import { theme } from "../theme";

/** The left column: chapter number, the current title and line, and progress through the scenes. */
export const ChapterLabel = ({ index, labels }: { index: number; labels: Label[] }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const active = labels.reduce((current, label, position) => (frame >= label.at * fps ? position : current), 0);
  const label = labels[active]!;
  const since = frame - label.at * fps;
  const enter = spring({ frame: since, fps, config: { damping: 18, stiffness: 120 } });
  const sub = interpolate(since, [8, 24], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: 128, top: 0, bottom: 0, width: 560, display: "flex", flexDirection: "column", justifyContent: "center", fontFamily: theme.font, color: theme.text }}>
      <div style={{ color: theme.green, fontSize: 26, fontWeight: 600, letterSpacing: 4, textTransform: "uppercase", opacity: 0.9 }}>
        {String(index + 1).padStart(2, "0")} <span style={{ color: theme.muted, fontWeight: 400 }}>/ {String(scenes.length).padStart(2, "0")}</span>
      </div>
      <div key={`${active}-title`} style={{ marginTop: 30, fontSize: 68, lineHeight: 1.08, fontWeight: 600, letterSpacing: -2, textWrap: "balance", opacity: enter, transform: `translateY(${(1 - enter) * 34}px)` }}>
        {label.title}
      </div>
      <div key={`${active}-sub`} style={{ marginTop: 26, fontSize: 32, lineHeight: 1.4, color: theme.muted, textWrap: "pretty", opacity: sub, transform: `translateY(${(1 - sub) * 18}px)` }}>
        {label.subtitle}
      </div>
      <div style={{ position: "absolute", bottom: 112, left: 0, display: "flex", gap: 10 }}>
        {scenes.map((scene, position) => (
          <span key={scene.id} style={{ width: position === index ? 40 : 13, height: 13, borderRadius: 7, background: position <= index ? theme.green : "rgba(255,255,255,0.14)", transition: "none" }} />
        ))}
      </div>
    </div>
  );
};
