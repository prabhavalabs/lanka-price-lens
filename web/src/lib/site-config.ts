import { useQuery } from "@tanstack/react-query";

/** What the deployment tells the site about itself: analytics and the community, each optional. */
export type SiteConfig = {
  analytics: { ga_measurement_id: string | null; meta_pixel_id: string | null };
  community: { discord_invite_url: string | null };
};

const empty: SiteConfig = { analytics: { ga_measurement_id: null, meta_pixel_id: null }, community: { discord_invite_url: null } };

/** The deployment config, fetched once per page load and shared by everything that needs it. */
export function useSiteConfig(): SiteConfig {
  const query = useQuery({
    queryKey: ["config"],
    queryFn: async () => ((await (await fetch("/v1/public/config")).json()) as { payload: Partial<SiteConfig> }).payload,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  return { analytics: { ...empty.analytics, ...query.data?.analytics }, community: { ...empty.community, ...query.data?.community } };
}
