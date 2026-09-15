import { AbsoluteFill, OffthreadVideo, staticFile, useVideoConfig } from "remotion";

import type { Scene } from "../scenes";
import { BrowserFrame } from "./BrowserFrame";
import { ChapterLabel } from "./ChapterLabel";
import { PhoneFrame } from "./PhoneFrame";

const clip = (name: string, from: number, fps: number) => (
  <OffthreadVideo muted src={staticFile(`clips/${name}.mp4`)} startFrom={Math.round(from * fps)} style={{ width: "100%", display: "block" }} />
);

/** One feature: the label on the left, the recording at its native size in a device frame on the right. Nothing moves but the text. */
export const SceneView = ({ scene, index }: { scene: Scene; index: number }) => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill>
      <ChapterLabel index={index} labels={scene.labels} />
      <div style={{ position: "absolute", left: 740, top: 0, bottom: 0, width: 1728, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {scene.kind === "browser" ? (
          <BrowserFrame url={scene.url} width={1728}>{clip(scene.clip, scene.from, fps)}</BrowserFrame>
        ) : (
          <div style={{ display: "flex", gap: 72, alignItems: "center" }}>
            {(scene.clips ?? [scene.clip, scene.clip]).map((name, position) => (
              <div key={name} style={{ transform: `translateY(${position === 0 ? -24 : 24}px)` }}>
                <PhoneFrame width={468}>{clip(name, scene.from, fps)}</PhoneFrame>
              </div>
            ))}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
