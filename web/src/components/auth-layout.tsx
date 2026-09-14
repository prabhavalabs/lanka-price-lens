import { Link, Outlet } from "react-router-dom";

/**
 * The frame for signing in, registering, and recovering an account: a blank page with the
 * mark, the form in the middle, and a way back for someone who only came to read prices.
 * No header or footer, so nothing competes with the one thing the page asks for.
 */
export function AuthLayout() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-8">
      <Link aria-label="PriceLens, home" className="mb-2 flex items-center gap-2.5 no-underline" to="/">
        <span aria-hidden className="grid size-9 place-items-center rounded-xl bg-primary font-heading text-lg font-bold text-primary-foreground shadow-sm">₨</span>
        <span className="font-heading text-lg font-semibold tracking-tight">PriceLens</span>
      </Link>
      <div className="w-full max-w-sm">
        <Outlet />
      </div>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        Only here for prices? <Link className="font-medium text-foreground" to="/">Continue as a guest</Link>
      </p>
    </div>
  );
}
