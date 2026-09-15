# PriceLens feature video

A Remotion project that turns short recordings of the live site into the under-a-minute
feature video used for social media (Reddit, LinkedIn). No voice-over; each feature gets a
chapter label beside a browser or phone frame.

## Record the clips

Recordings come from the live site with a seeded basket and a drawn cursor. The page is
zoomed 1.2x inside a 1728x1080 viewport so it lays out like a 1440-wide window but records
crisp at 1:1 for the 2560x1440 video (Playwright captures at CSS pixels and never upscales;
its recorder runs at 25 fps, which the video keeps). From the repository root, with
`playwright-cli` installed globally:

```sh
playwright-cli open
playwright-cli run-code --filename=marketing/promo/record.js
playwright-cli close
cd marketing/promo
for f in public/clips/*.webm; do ffmpeg -y -i "$f" -c:v libx264 -preset slow -crf 15 -pix_fmt yuv420p -r 25 -movflags +faststart "${f%.webm}.mp4"; done
```

The first run needs Playwright's ffmpeg once: `npx playwright install ffmpeg` (from the
`@playwright/cli` package's own `playwright-core`, see the session notes in
`docs/public-site.md` if the global one is used).

## Edit and render

```sh
pnpm install
pnpm studio          # preview in the browser, scrub, tweak
pnpm render          # writes out/pricelens-promo.mp4 (2560x1440, 25 fps, h264 crf 16)
```

Scenes, their trim points, durations, and labels live in `src/scenes.ts`. Scenes are hard
cuts: the device frame stays put and only the chapter text animates, so the footage is never
faded or scaled. The look (colours, font) is `src/theme.ts`; the pieces are in
`src/components`. Check trim points on contact sheets before a full render:
`ffmpeg -i public/clips/board.mp4 -vf "fps=2,scale=420:-1,tile=6x6" -frames:v 1 sheet.png`.
