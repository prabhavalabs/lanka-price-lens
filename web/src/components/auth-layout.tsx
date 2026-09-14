import { Outlet } from "react-router-dom";

/**
 * The frame for signing in, registering, and recovering an account: a blank page with the
 * card in the middle and nothing else, so nothing competes with the one thing the page asks
 * for. The mark and the way back for guests live inside the card (AuthCard).
 */
export function AuthLayout() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <Outlet />
      </div>
    </div>
  );
}
