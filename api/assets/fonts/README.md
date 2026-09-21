IBM Plex Sans (400, 500, 600, 700), TrueType, from Google Fonts. Licensed under the SIL Open
Font License 1.1 (https://github.com/IBM/plex/blob/master/LICENSE.txt). Used by the API to draw
the link-preview cards in `src/og.ts`; the website loads the same family from `@fontsource-variable`.

Noto Sans Sinhala (400, 600, 700), TrueType, from Google Fonts, under the same licence
(https://github.com/notofonts/sinhala/blob/main/OFL.txt). IBM Plex has no Sinhala glyphs and the
card renderer is told not to read the system's fonts, so without these every Sinhala word on a
card would be drawn as an empty box.
