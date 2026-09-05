import { type FormEvent, type ReactNode, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

export function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    navigate(query.trim() ? `/?q=${encodeURIComponent(query.trim())}` : "/");
  };
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-line">
        <div className="mx-auto max-w-5xl px-4 py-3 flex flex-wrap items-center gap-3">
          <Link to="/" className="flex items-center gap-2 no-underline">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white font-bold">₨</span>
            <span className="text-lg font-semibold tracking-tight">PriceLens</span>
            <span className="hidden sm:inline text-sm text-ink-soft">Sri Lanka food prices</span>
          </Link>
          <form onSubmit={submit} className="ml-auto flex-1 sm:flex-none sm:w-72" role="search">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search rice, dhal, chicken…"
              aria-label="Search products"
              className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </form>
          <nav className="text-sm text-ink-soft">
            <Link to="/about" className="hover:text-brand">About</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
      <footer className="border-t border-line bg-white">
        <div className="mx-auto max-w-5xl px-4 py-6 text-xs text-ink-soft space-y-1">
          <p>Prices are as observed on the date shown and may differ in store or at the stall. Rupees, per unit as stated.</p>
          <p>
            Open-market prices: Central Bank of Sri Lanka daily price report, Department of Census and Statistics weekly retail prices, HARTI daily bulletin. Supermarket prices: the retailers' online stores.
            {" "}<Link to="/about" className="underline">Sources and method</Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
