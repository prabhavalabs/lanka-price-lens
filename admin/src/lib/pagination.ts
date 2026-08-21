export type PaginationItem = number | "start-ellipsis" | "end-ellipsis";

export function paginationItems(page: number, pages: number): PaginationItem[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);

  const start = page <= 3 ? 2 : page >= pages - 2 ? pages - 3 : page - 1;
  const end = page <= 3 ? 4 : page >= pages - 2 ? pages - 1 : page + 1;

  return [
    1,
    ...(start > 2 ? ["start-ellipsis" as const] : []),
    ...Array.from({ length: end - start + 1 }, (_, index) => start + index),
    ...(end < pages - 1 ? ["end-ellipsis" as const] : []),
    pages,
  ];
}
