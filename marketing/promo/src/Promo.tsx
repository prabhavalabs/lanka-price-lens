import { AbsoluteFill, Sequence } from "remotion";

import { Backdrop } from "./components/Backdrop";
import { Intro } from "./components/Intro";
import { Outro } from "./components/Outro";
import { SceneView } from "./components/SceneView";
import { FPS, frames, INTRO_SECONDS, OUTRO_SECONDS, scenes } from "./scenes";

/** Intro, the feature scenes, and the outro as hard cuts; only the text animates. */
export const Promo = () => {
  let at = frames(INTRO_SECONDS);
  return (
    <AbsoluteFill style={{ backgroundColor: "#0b1411" }}>
      <Backdrop />
      <Sequence durationInFrames={frames(INTRO_SECONDS)}>
        <Intro />
      </Sequence>
      {scenes.map((scene, index) => {
        const from = at;
        at += frames(scene.seconds);
        return (
          <Sequence durationInFrames={frames(scene.seconds)} from={from} key={scene.id} premountFor={FPS}>
            <SceneView index={index} scene={scene} />
          </Sequence>
        );
      })}
      <Sequence durationInFrames={frames(OUTRO_SECONDS)} from={at}>
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
};
