/**
 * The feature scenes in order. Each shows one recorded clip (public/clips/<clip>.mp4) inside a
 * device frame with a chapter label; a scene can change its label part way through. `from` skips
 * the clip's first seconds (page load), `seconds` is how long the scene stays on screen.
 */
export type Label = { at: number; title: string; subtitle: string };

export type Scene = {
  id: string;
  kind: "browser" | "phones";
  clip: string;
  clips?: [string, string];
  url: string;
  from: number;
  seconds: number;
  labels: Label[];
};

export const FPS = 25;

export const scenes: Scene[] = [
  { id: "board", kind: "browser", clip: "board", url: "price.prabhavalabs.com", from: 0.6, seconds: 5, labels: [{ at: 0, title: "Every food price, one board", subtitle: "Open markets and supermarkets side by side, refreshed daily from official bulletins and store shelves." }] },
  { id: "search", kind: "browser", clip: "search", url: "price.prabhavalabs.com", from: 2.2, seconds: 6.4, labels: [{ at: 0, title: "Search in any spelling", subtitle: "English, Sinhala, or Tamil. Rough spelling and shelf labels both land on the right product." }] },
  { id: "product", kind: "browser", clip: "product", url: "price.prabhavalabs.com/p/big-onion", from: 2.5, seconds: 7.5, labels: [
    { at: 0, title: "Every seller, cheapest marked", subtitle: "Central Bank and Census surveys, four supermarket chains, and the wholesale market, each with the date it was seen." },
    { at: 3.6, title: "History, seller by seller", subtitle: "30 days, 90 days, or a year. Hover any day for every price on it." },
  ] },
  { id: "add", kind: "browser", clip: "add", url: "price.prabhavalabs.com/p/big-onion", from: 1.6, seconds: 9.6, labels: [
    { at: 0, title: "A basket in real amounts", subtitle: "Half a kilo, two kilos, or an exact figure. It stays in your browser, no account." },
    { at: 6.8, title: "Then compare stores", subtitle: "One click from any page." },
  ] },
  { id: "basket", kind: "browser", clip: "basket", url: "price.prabhavalabs.com/basket", from: 1.0, seconds: 10, labels: [
    { at: 0, title: "Where the whole list costs least", subtitle: "Every store priced for your amounts. Stores that carry everything come first." },
    { at: 4.6, title: "Cook from what you have", subtitle: "363 Sri Lankan dishes ranked by fit, with what is still to buy at today's cheapest price." },
  ] },
  { id: "dark", kind: "browser", clip: "dark", url: "price.prabhavalabs.com/p/big-onion", from: 2.8, seconds: 3.8, labels: [{ at: 0, title: "Light or dark", subtitle: "Follows your device, or pick one." }] },
  { id: "phones", kind: "phones", clip: "phone-board", clips: ["phone-board", "phone-basket"], url: "", from: 0.8, seconds: 4.6, labels: [{ at: 0, title: "Made for the phone", subtitle: "Add it to your home screen. Same board, same basket, one thumb." }] },
];

export const INTRO_SECONDS = 3;
export const OUTRO_SECONDS = 4.2;

export const frames = (seconds: number) => Math.round(seconds * FPS);

/** Scenes are hard cuts: intro, each scene, outro, back to back. */
export const totalFrames = () => frames(INTRO_SECONDS) + scenes.reduce((sum, scene) => sum + frames(scene.seconds), 0) + frames(OUTRO_SECONDS);
