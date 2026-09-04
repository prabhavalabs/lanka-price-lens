import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A distinctive mark for every seller. Supermarkets get a brand-coloured monogram;
 * wholesale and retail markets get a glyph drawn from the place itself (Pettah's
 * clock tower, Dambulla's rock, the Kelani bridge at Peliyagoda), so a reader tells
 * sellers apart at a glance in tables and chart legends. Retail-market marks are
 * tinted rather than solid, so Pettah wholesale and Pettah retail share a symbol
 * but never look the same. Any market without a drawn mark still gets a stable
 * colour and initials derived from its id, so a new market never renders blank.
 */

type Place = { color: string; glyph?: ReactNode; monogram?: string; accent?: string };

const places: Record<string, Place> = {
  keells: { color: "#1E9E4A", monogram: "K" },
  cargills: { color: "#D9262B", monogram: "C" },
  spar: { color: "#0B6E46", monogram: "S", accent: "#E1251B" },
  glomark: { color: "#E8590C", monogram: "G" },
  pettah: {
    color: "#B45309",
    glyph: (
      <>
        <path d="M9 21V9h6v12" />
        <path d="M8 9l4-4 4 4" />
        <circle cx="12" cy="13" r="1.9" />
        <path d="M12 13v-1.2M12 13h.9" />
        <path d="M6 21h12" />
      </>
    ),
  },
  dambulla: {
    color: "#7C3AED",
    glyph: (
      <>
        <path d="M3 19c1.5-7 5.5-11 9-11s7.5 4 9 11" />
        <path d="M9 19v-2.5a3 3 0 0 1 6 0V19" />
        <path d="M3 19h18" />
      </>
    ),
  },
  peliyagoda: {
    color: "#0891B2",
    glyph: (
      <>
        <path d="M3 14c3-4.5 6-6.5 9-6.5s6 2 9 6.5" />
        <path d="M3 14h18" />
        <path d="M7 14v3M12 14v3M17 14v3" />
        <path d="M3 20c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0" />
      </>
    ),
  },
  colombo_district: {
    color: "#BE185D",
    glyph: (
      <>
        <path d="M12 21v-9" />
        <path d="M12 12c-3.5 0-5.5-2.5-6-6 2 .8 4 1.2 6 3.5 2-2.3 4-2.7 6-3.5-.5 3.5-2.5 6-6 6z" />
        <path d="M8.5 21h7" />
      </>
    ),
  },
  narahenpita: {
    color: "#D97706",
    glyph: (
      <>
        <path d="M4 10l2-4h12l2 4" />
        <path d="M4 10c0 1.5 1.2 2.5 2.7 2.5S9.3 11.5 9.3 10c0 1.5 1.2 2.5 2.7 2.5s2.7-1 2.7-2.5c0 1.5 1.2 2.5 2.7 2.5S20 11.5 20 10" />
        <path d="M6 12.5V21M18 12.5V21M6 16h12" />
      </>
    ),
  },
  negombo: {
    color: "#155E75",
    glyph: (
      <>
        <path d="M4 16h16l-2.5 3.5H6.5z" />
        <path d="M12 16V4" />
        <path d="M12 5c3 2 5 5.5 5.5 10H12" />
      </>
    ),
  },
  nuwara_eliya: {
    color: "#065F46",
    glyph: (
      <>
        <path d="M2 19l6-10 4 6 3-4.5 7 8.5z" />
        <path d="M17 5c0 2-1 3-3 3 0-2 1-3 3-3z" />
      </>
    ),
  },
  kandy: {
    color: "#A21CAF",
    glyph: (
      <>
        <path d="M5 11l7-6.5 7 6.5" />
        <path d="M7 11v9h10v-9" />
        <path d="M10.5 20v-3.5a1.5 1.5 0 0 1 3 0V20" />
        <path d="M12 4.5v-2" />
        <path d="M4 20h16" />
      </>
    ),
  },
  meegoda: {
    color: "#92400E",
    glyph: (
      <>
        <path d="M2 16V7h11v9" />
        <path d="M13 10h4.5l3.5 3.5V16" />
        <path d="M2 16h19" />
        <circle cx="6.5" cy="18" r="1.8" />
        <circle cx="17" cy="18" r="1.8" />
      </>
    ),
  },
  bandarawela: {
    color: "#4D7C0F",
    glyph: (
      <>
        <path d="M2 17c3-5 6-6 9-3s6 4 11-3" />
        <path d="M2 21c3-4 6-5 9-2.5s6 3.5 11-2" />
        <path d="M15 6c0 2.5-1.3 4-3.5 4 0-2.5 1.3-4 3.5-4z" />
      </>
    ),
  },
  keppetipola: {
    color: "#1D4ED8",
    glyph: (
      <>
        <path d="M3 20h18M4.5 16h15M6.5 12h11M9 8h6" />
        <path d="M12 8V4.5" />
      </>
    ),
  },
  thambuththegama: {
    color: "#A16207",
    glyph: (
      <>
        <path d="M12 21V8" />
        <path d="M8 21c0-6 1.5-10 4-13M16 21c0-6-1.5-10-4-13" />
        <path d="M12 8l-2.5-3M12 8l2.5-3M12 12l-2-2.5M12 12l2-2.5" />
      </>
    ),
  },
  norochchole: {
    color: "#475569",
    glyph: (
      <>
        <path d="M12 21v-9.5" />
        <path d="M12 11.5V3.5M12 11.5l6.9 4M12 11.5l-6.9 4" />
        <circle cx="12" cy="11.5" fill="currentColor" r="1.6" />
        <path d="M8.5 21h7" />
      </>
    ),
  },
  veyangoda: {
    color: "#9F1239",
    glyph: (
      <>
        <path d="M7 21l3.5-17M17 21l-3.5-17" />
        <path d="M8.2 17.5h7.6M9.2 13h5.6M10 9h4" />
      </>
    ),
  },
};

const sizes = { xs: "size-4", sm: "size-6", md: "size-8", lg: "size-10" } as const;

/** "market_pettah_retail" and "market_pettah" both draw Pettah; "market_keells_online" draws Keells. */
export function placeOf(marketId: string): string {
  return marketId.replace(/^market_/u, "").replace(/_(retail|wholesale|online|store)$/u, "");
}

function hashedColor(seed: string): string {
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 55% 38%)`;
}

function initials(label: string): string {
  const words = label.replace(/\(.*?\)/gu, "").trim().split(/\s+/u).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]!.toUpperCase()).join("") || "?";
}

export function sellerColor(marketId: string): string {
  return places[placeOf(marketId)]?.color ?? hashedColor(marketId);
}

export function SellerMark({ marketId, label, type, size = "sm", className }: { marketId: string; label: string; type: string; size?: keyof typeof sizes; className?: string | undefined }) {
  const place = places[placeOf(marketId)];
  const color = place?.color ?? hashedColor(marketId);
  // Retail markets are drawn tinted so they never pass for the wholesale market of the same town.
  const tinted = type === "retail_market";
  const ink = tinted ? color : "#ffffff";
  const monogram = place?.glyph ? null : place?.monogram ?? initials(label);
  return (
    <svg aria-label={label} className={cn("shrink-0", sizes[size], className)} role="img" viewBox="0 0 24 24">
      {tinted ? (
        <rect fill={color} fillOpacity="0.16" height="22.5" rx="5.5" stroke={color} strokeOpacity="0.6" strokeWidth="1.5" width="22.5" x="0.75" y="0.75" />
      ) : (
        <rect fill={color} height="24" rx="6" width="24" />
      )}
      {place?.glyph ? (
        <g fill="none" stroke={ink} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" style={{ color: ink }}>{place.glyph}</g>
      ) : (
        <text fill={ink} fontFamily="inherit" fontSize={monogram && monogram.length > 1 ? 10 : 13} fontWeight="700" textAnchor="middle" x="12" y={monogram && monogram.length > 1 ? 15.6 : 16.6}>{monogram}</text>
      )}
      {place?.accent ? <circle cx="18.5" cy="5.5" fill={place.accent} r="2.2" stroke={tinted ? "none" : color} strokeWidth="1" /> : null}
    </svg>
  );
}
