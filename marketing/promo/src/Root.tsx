import "@fontsource-variable/ibm-plex-sans";

import { Composition } from "remotion";

import { Promo } from "./Promo";
import { FPS, totalFrames } from "./scenes";

export const Root = () => (
  <Composition component={Promo} durationInFrames={totalFrames()} fps={FPS} height={1440} id="Promo" width={2560} />
);
