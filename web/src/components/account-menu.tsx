import { RiBookletLine, RiCalendarEventLine, RiLogoutBoxRLine, RiStarLine, RiUserLine } from "@remixicon/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { accountApi } from "@/lib/account-api";
import { initials, locationPath, withReturnTo } from "@/lib/account-forms";
import { setAccountProfile, useAccount } from "@/store/account";

/**
 * The header's account control: "Sign in" when nobody is, the person's picture or initials
 * opening a small menu when someone is. Signing out on an account page goes home; anywhere
 * else the page stays and simply forgets who was signed in.
 */
export function AccountMenu() {
  const account = useAccount();
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const signOut = useMutation({
    mutationFn: () => accountApi.logout(),
    onSettled: () => {
      setAccountProfile(client, null);
      client.removeQueries({ queryKey: ["account"], exact: false, predicate: (query) => query.queryKey[1] !== "me" });
      if (location.pathname.startsWith("/account")) navigate("/");
    },
  });
  if (account.status === "loading") return <Skeleton aria-hidden className="mx-1 size-6 rounded-full" />;
  if (account.status === "signed_out") {
    return (
      <Button asChild className="gap-1.5 px-1.5 md:px-2.5" size="sm" variant="ghost">
        <Link className="no-underline" to={withReturnTo("/account/login", locationPath(location))}><RiUserLine className="size-4" /><span className="hidden md:inline">Sign in</span></Link>
      </Button>
    );
  }
  const person = account.account;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label={`Account menu for ${person.display_name}`} className="rounded-full" size="icon-sm" variant="ghost">
          <Avatar size="sm">
            {person.avatar_url ? <AvatarImage alt="" referrerPolicy="no-referrer" src={person.avatar_url} /> : null}
            <AvatarFallback className="bg-primary/15 text-[10px] font-semibold text-primary">{initials(person.display_name, person.email.slice(0, 1).toUpperCase())}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="space-y-0.5">
          <span className="block truncate font-medium text-popover-foreground">{person.display_name}</span>
          <span className="block truncate">{person.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link className="no-underline" to="/account"><RiUserLine />Account</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link className="no-underline" to="/menus"><RiCalendarEventLine />Menus</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link className="no-underline" to="/account/recipes"><RiBookletLine />My recipes</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link className="no-underline" to="/account#wishlist"><RiStarLine />Wishlist</Link></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={signOut.isPending} onSelect={() => signOut.mutate()}><RiLogoutBoxRLine />{signOut.isPending ? "Signing out" : "Sign out"}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
