import { useEffect, useState } from "react";
import { RiBookmarkLine, RiChat1Line, RiComputerLine, RiHeartLine, RiSendPlaneLine, RiShareForwardLine, RiSmartphoneLine, RiThumbUpLine, RiEarthLine, RiMoreFill } from "@remixicon/react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Platform } from "@/lib/api";

/**
 * A post as its platform shows it. Not a screenshot and not a guess at pixels: the frame around
 * the post follows what Facebook and Instagram actually do with it — where the caption folds,
 * whether a link is tappable, how the picture is cropped — so what is checked here is the thing
 * a reader will meet, on the width they will meet it at.
 */

export type DeviceKind = "desktop" | "mobile";

/** The column a post is read in: Facebook's feed on a desktop, and a phone's screen. */
const deviceWidth: Record<DeviceKind, number> = { desktop: 500, mobile: 375 };

/** Where each platform folds a long caption, in characters, and what the fold is called. */
const fold: Record<Platform, { at: number; more: string }> = {
  facebook: { at: 480, more: "See more" },
  instagram: { at: 125, more: "more" },
};

const timeWords = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / (60 * 24))}d`;
};

/** An address in a Facebook post becomes a link on its own; the rest stays plain. */
function withLinks(text: string, linked: boolean) {
  if (!linked) return text;
  return text.split(/(https?:\/\/\S+|\b[a-z0-9-]+\.(?:com|lk|org|net)\/\S*)/giu).map((piece, index) =>
    /^(https?:\/\/|[a-z0-9-]+\.(?:com|lk|org|net)\/)/iu.test(piece)
      ? <span className="text-[#4599ff]" key={index}>{piece}</span>
      : <span key={index}>{piece}</span>,
  );
}

function Caption({ text, platform, linked }: { text: string; platform: Platform; linked: boolean }) {
  const [open, setOpen] = useState(false);
  const rule = fold[platform];
  const long = text.length > rule.at;
  const shown = open || !long ? text : `${text.slice(0, rule.at).trimEnd()}… `;
  return (
    <p className="whitespace-pre-wrap break-words text-[15px] leading-[1.35]">
      {withLinks(shown, linked)}
      {long && !open ? (
        <button className="text-[#b0b3b8] hover:underline" onClick={() => setOpen(true)} type="button">{rule.more}</button>
      ) : null}
    </p>
  );
}

function Avatar({ picture, name }: { picture: string | null; name: string }) {
  return picture ? (
    <img alt="" className="size-10 shrink-0 rounded-full object-cover" src={picture} />
  ) : (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#3a3b3c] text-sm font-semibold text-white">{name.slice(0, 1).toUpperCase()}</div>
  );
}

export type PreviewPost = {
  platform: Platform;
  text: string;
  image: string | null;
  imageAlt: string | null;
  account: { name: string; username: string | null; picture: string | null } | null;
  createdAt: string;
};

/** Facebook's own colours, so the preview is read as the platform and not as the admin. */
function FacebookFrame({ post, width }: { post: PreviewPost; width: number }) {
  const name = post.account?.name ?? "PriceLens";
  return (
    <div className="overflow-hidden rounded-lg bg-[#242526] font-sans text-[#e4e6eb] shadow-lg" style={{ width }}>
      <div className="flex items-center gap-2 p-3">
        <Avatar name={name} picture={post.account?.picture ?? null} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-tight">{name}</p>
          <p className="flex items-center gap-1 text-[13px] text-[#b0b3b8]">{timeWords(post.createdAt)} · <RiEarthLine className="size-3" /></p>
        </div>
        <RiMoreFill className="size-5 text-[#b0b3b8]" />
      </div>
      <div className="px-3 pb-3"><Caption linked platform="facebook" text={post.text} /></div>
      {post.image ? <img alt={post.imageAlt ?? ""} className="w-full bg-black object-contain" src={post.image} /> : null}
      <div className="flex items-center justify-around border-t border-[#3e4042] py-1 text-[15px] font-medium text-[#b0b3b8]">
        <span className="flex items-center gap-2 px-3 py-2"><RiThumbUpLine className="size-5" />Like</span>
        <span className="flex items-center gap-2 px-3 py-2"><RiChat1Line className="size-5" />Comment</span>
        <span className="flex items-center gap-2 px-3 py-2"><RiShareForwardLine className="size-5" />Share</span>
      </div>
    </div>
  );
}

function InstagramFrame({ post, width }: { post: PreviewPost; width: number }) {
  const handle = post.account?.username ?? post.account?.name ?? "pricelens";
  return (
    <div className="overflow-hidden rounded-lg border border-[#262626] bg-black font-sans text-white shadow-lg" style={{ width }}>
      <div className="flex items-center gap-2 p-3">
        <Avatar name={handle} picture={post.account?.picture ?? null} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold leading-tight">{handle}</p>
          <p className="text-[12px] text-[#a8a8a8]">Sponsored · {timeWords(post.createdAt)}</p>
        </div>
        <RiMoreFill className="size-5" />
      </div>
      {/* Instagram crops a feed picture to at most 4:5; a taller card loses its top and bottom. */}
      {post.image ? (
        <div className="w-full overflow-hidden bg-black" style={{ aspectRatio: "4 / 5" }}>
          <img alt={post.imageAlt ?? ""} className="size-full object-cover" src={post.image} />
        </div>
      ) : (
        <div className="flex aspect-square items-center justify-center bg-[#1a1a1a] text-[13px] text-[#a8a8a8]">Instagram takes no post without a picture</div>
      )}
      <div className="flex items-center gap-4 px-3 pt-3 text-white">
        <RiHeartLine className="size-6" />
        <RiChat1Line className="size-6" />
        <RiSendPlaneLine className="size-6" />
        <RiBookmarkLine className="ml-auto size-6" />
      </div>
      <div className="px-3 pb-4 pt-2">
        <p className="mb-1 text-[14px] font-semibold">{handle}</p>
        {/* A caption here carries no tappable link, which is why the address is named in words. */}
        <Caption linked={false} platform="instagram" text={post.text} />
      </div>
    </div>
  );
}

/** The post, its platform's frame, and the width it is read at. */
export function PostPreviewFrame({ post, device, onDevice }: { post: PreviewPost; device: DeviceKind; onDevice: (device: DeviceKind) => void }) {
  const [width, setWidth] = useState(deviceWidth[device]);
  useEffect(() => setWidth(deviceWidth[device]), [device]);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {post.platform === "facebook" ? "As the Page's followers see it in their feed." : "As the account's followers see it, cropped the way Instagram crops a feed picture."}
        </p>
        <ToggleGroup onValueChange={(value) => { if (value) onDevice(value as DeviceKind); }} size="sm" type="single" value={device} variant="outline">
          <ToggleGroupItem aria-label="Desktop" value="desktop"><RiComputerLine className="size-4" />Desktop</ToggleGroupItem>
          <ToggleGroupItem aria-label="Mobile" value="mobile"><RiSmartphoneLine className="size-4" />Mobile</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="flex justify-center rounded-lg bg-[#18191a] p-4">
        {post.platform === "instagram" ? <InstagramFrame post={post} width={width} /> : <FacebookFrame post={post} width={width} />}
      </div>
    </div>
  );
}
