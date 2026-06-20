import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet, useNavigate } from "react-router";
import { useOnline } from "../lib/useOnline";
import { AddSheet } from "../features/add/AddSheet";
import { PullToRefresh } from "../features/pwa/PullToRefresh";
import { Sheet } from "../components/Sheet";
import { QuickAddGrid } from "../features/quickadd/QuickAddGrid";
import { PetAvatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { IconButton } from "../components/IconButton";
import {
  CalendarIcon,
  GearIcon,
  HeartIcon,
  HomeIcon,
  ListIcon,
  PawIcon,
  PlusIcon,
} from "../components/icons";
import { parseQuickAction } from "../lib/quickAction";
import type { Category } from "@pawary/shared";
import { useT } from "../i18n";
import { cn } from "../lib/cn";
import { usePets } from "../state/pets";
import { Onboarding } from "./Onboarding";

export type ShellOutletContext = {
  openAdd: () => void;
  openQuickAdd: () => void;
};

function TabLink({
  to,
  label,
  children,
}: {
  to: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold transition",
          isActive ? "text-clay-600" : "text-ink-faint hover:text-ink-soft",
        )
      }
    >
      {children}
      <span>{label}</span>
    </NavLink>
  );
}

function SideLink({
  to,
  label,
  children,
}: {
  to: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-full px-4 py-2.5 font-semibold transition",
          isActive
            ? "bg-clay-100 text-clay-800"
            : "text-ink-soft hover:bg-cream-100 hover:text-ink",
        )
      }
    >
      {children}
      <span>{label}</span>
    </NavLink>
  );
}

export function Shell() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pets, selectedPet, selectPet } = usePets();
  const online = useOnline();
  const [addOpen, setAddOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickCategory, setQuickCategory] = useState<Category | undefined>(
    undefined,
  );

  // On launch, honor a quick-add deep link (?action=quickadd[&category=…]) from
  // Android manifest shortcuts / iOS Apple Shortcuts / home-screen bookmarks,
  // then strip the params so reload/back is clean and does not re-trigger.
  useEffect(() => {
    const { open, category } = parseQuickAction(window.location.search);
    if (!open) return;
    setQuickCategory(category);
    setQuickOpen(true);
    const url = window.location.pathname + window.location.hash;
    window.history.replaceState(null, "", url || "/");
  }, []);

  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);

  const clearPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const outletContext: ShellOutletContext = {
    openAdd: () => setAddOpen(true),
    openQuickAdd: () => setQuickOpen(true),
  };

  if (!selectedPet) {
    return <Onboarding />;
  }

  const canEdit = selectedPet.role !== "viewer";

  return (
    <div className="min-h-dvh bg-cream-100">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-cream-200 bg-paper px-4 py-6 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2 font-display text-2xl text-clay-700">
          <PawIcon className="h-7 w-7" />
          {t.appName}
        </div>
        <nav className="flex flex-col gap-1" aria-label={t.shell.mainNav}>
          <SideLink to="/" label={t.nav.home}>
            <HomeIcon className="h-5 w-5" />
          </SideLink>
          <SideLink to="/calendar" label={t.nav.calendar}>
            <CalendarIcon className="h-5 w-5" />
          </SideLink>
          <SideLink to="/log" label={t.nav.log}>
            <ListIcon className="h-5 w-5" />
          </SideLink>
          <SideLink to="/health" label={t.nav.health}>
            <HeartIcon className="h-5 w-5" />
          </SideLink>
        </nav>
        <div className="mt-auto">
          <SideLink to="/settings" label={t.nav.settings}>
            <GearIcon className="h-5 w-5" />
          </SideLink>
        </div>
      </aside>

      <div className="md:pl-60">
        {/* header: wordmark (mobile), pet switcher, add (desktop), settings */}
        <header className="pt-safe sticky top-0 z-30 border-b border-cream-200 bg-cream-100/90 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-2.5">
            <span className="flex items-center gap-1.5 font-display text-lg text-clay-700 md:hidden">
              <PawIcon className="h-6 w-6" />
              {t.appName}
            </span>
            <div
              role="group"
              aria-label={t.shell.petSwitcher}
              className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto"
            >
              {pets.map((pet) => {
                const selected = pet.id === selectedPet.id;
                return (
                  <button
                    key={pet.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => selectPet(pet.id)}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 transition active:scale-95",
                      selected
                        ? "border-clay-300 bg-clay-50"
                        : "border-transparent opacity-70 hover:opacity-100",
                    )}
                  >
                    <PetAvatar pet={pet} size="sm" />
                    <span className="text-sm font-semibold text-ink">
                      {pet.name}
                    </span>
                  </button>
                );
              })}
            </div>
            {canEdit && (
              <Button
                size="sm"
                className="hidden md:inline-flex"
                onClick={() => setAddOpen(true)}
              >
                <PlusIcon className="h-4 w-4" />
                {t.nav.addActivity}
              </Button>
            )}
            <IconButton
              label={t.nav.settings}
              className="md:hidden"
              onClick={() => navigate("/settings")}
            >
              <GearIcon className="h-5 w-5" />
            </IconButton>
          </div>
          {!online && (
            <div
              role="status"
              className="bg-ink px-4 py-1 text-center text-xs font-semibold text-cream-50"
            >
              {t.pwa.offline}
            </div>
          )}
        </header>

        <PullToRefresh
          onRefresh={() => queryClient.refetchQueries({ type: "active" })}
        >
          <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-4 md:pb-12">
            <Outlet context={outletContext} />
          </main>
        </PullToRefresh>
      </div>

      {/* mobile tab bar + overlapping FAB */}
      <nav
        aria-label={t.shell.mainNav}
        className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-cream-200 bg-paper/95 backdrop-blur md:hidden"
      >
        <div className="mx-auto grid max-w-md grid-cols-5 items-center px-2">
          <TabLink to="/" label={t.nav.home}>
            <HomeIcon className="h-6 w-6" />
          </TabLink>
          <TabLink to="/calendar" label={t.nav.calendar}>
            <CalendarIcon className="h-6 w-6" />
          </TabLink>
          <div className="relative flex justify-center">
            {canEdit && (
              <button
                type="button"
                aria-label={t.nav.addActivity}
                onContextMenu={(e) => e.preventDefault()}
                onPointerDown={() => {
                  longPressed.current = false;
                  pressTimer.current = window.setTimeout(() => {
                    longPressed.current = true;
                    setQuickOpen(true);
                  }, 500);
                }}
                onPointerUp={clearPress}
                onPointerLeave={clearPress}
                onPointerCancel={clearPress}
                onClick={() => {
                  if (!longPressed.current) setAddOpen(true);
                }}
                className="shadow-fab -mt-7 flex h-14 w-14 items-center justify-center rounded-full bg-clay-500 text-white transition active:scale-95"
              >
                <span className="relative">
                  <PawIcon className="h-7 w-7" />
                  <PlusIcon
                    strokeWidth={3}
                    className="absolute -right-1.5 -top-1.5 h-3.5 w-3.5"
                  />
                </span>
              </button>
            )}
          </div>
          <TabLink to="/log" label={t.nav.log}>
            <ListIcon className="h-6 w-6" />
          </TabLink>
          <TabLink to="/health" label={t.nav.health}>
            <HeartIcon className="h-6 w-6" />
          </TabLink>
        </div>
      </nav>
      {canEdit && <AddSheet open={addOpen} onClose={() => setAddOpen(false)} />}
      {canEdit && (
        <Sheet
          open={quickOpen}
          onClose={() => {
            setQuickOpen(false);
            setQuickCategory(undefined);
          }}
          title={t.quickAdd.title}
        >
          <QuickAddGrid
            petId={selectedPet.id}
            category={quickCategory}
            onLogged={() => {
              setQuickOpen(false);
              setQuickCategory(undefined);
            }}
          />
        </Sheet>
      )}
    </div>
  );
}
