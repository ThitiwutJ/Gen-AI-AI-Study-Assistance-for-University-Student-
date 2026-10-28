"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { BookOpenText, FileStack, LayoutGrid, Library, ListChecks, Menu, MessagesSquare, NotebookPen, Settings, X } from "lucide-react";
import { cx } from "@/components/ui";
import { AIStatusProvider, ToastProvider } from "./providers";
import { StatusPill } from "./StatusPill";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutGrid },
  { href: "/tutor", label: "AI Tutor", icon: MessagesSquare },
  { href: "/materials", label: "Study Materials", icon: FileStack },
  { href: "/notes", label: "Summaries & Notes", icon: NotebookPen },
  { href: "/quizzes", label: "Practice Quizzes", icon: ListChecks },
  { href: "/library", label: "Study Library", icon: Library },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-2">
      <span className="flex size-8 items-center justify-center rounded-md bg-ink text-white">
        <BookOpenText className="size-[18px]" aria-hidden />
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold text-ink">Gen AI</span>
        <span className="block text-[11.5px] text-ink-3">Runs on your own laptop</span>
      </span>
    </Link>
  );
}

function Nav({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="space-y-0.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[14px] transition-colors",
              active ? "bg-ink text-white" : "text-ink-2 hover:bg-black/[0.045] hover:text-ink",
            )}
          >
            <Icon className="size-[17px]" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setMenuOpen(false);
  }

  return (
    <ToastProvider>
      <AIStatusProvider>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
          Skip to content
        </a>
        <div className="flex min-h-dvh">
          {/* Desktop sidebar */}
          <aside className="sticky top-0 hidden h-dvh w-[236px] shrink-0 flex-col border-r border-rule bg-surface px-3 py-4 lg:flex">
            <Brand />
            <div className="mt-6 flex-1">
              <Nav pathname={pathname} />
            </div>
            <StatusPill />
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            {/* Mobile / tablet top bar */}
            <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-rule bg-surface px-4 lg:hidden">
              <Brand />
              <button
                aria-label={menuOpen ? "Close menu" : "Open menu"}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((o) => !o)}
                className="flex size-9 items-center justify-center rounded-md text-ink-2 hover:bg-black/[0.05]"
              >
                {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
              </button>
            </header>
            {menuOpen && (
              <div className="fixed inset-0 top-14 z-20 lg:hidden">
                <div className="absolute inset-0 bg-ink/25" onClick={() => setMenuOpen(false)} />
                <div className="relative border-b border-rule bg-surface px-3 py-3">
                  <Nav pathname={pathname} onNavigate={() => setMenuOpen(false)} />
                  <div className="mt-3">
                    <StatusPill />
                  </div>
                </div>
              </div>
            )}
            <main id="main" className="min-w-0 flex-1">
              {children}
            </main>
          </div>
        </div>
      </AIStatusProvider>
    </ToastProvider>
  );
}

export function PageContainer({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <div className={cx("mx-auto w-full px-4 py-6 sm:px-6 lg:px-10 lg:py-9", wide ? "max-w-[1320px]" : "max-w-[1120px]")}>{children}</div>;
}
