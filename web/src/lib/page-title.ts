import { useEffect } from "react";

/**
 * Sets the browser title for a page. The prerendered HTML carries a title for crawlers; this keeps
 * it right as people move around the app, which is also what the analytics page view reports.
 * Pass nothing until the page knows its title (a product or a dish still loading).
 */
export function usePageTitle(title: string | undefined): void {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}
