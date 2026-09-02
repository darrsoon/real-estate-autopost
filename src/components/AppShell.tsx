"use client";

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import NavLink from '@/components/NavLink';

export type NavItem = { href: string; label: string; icon: string };

type Props = {
  items: NavItem[];
  children: React.ReactNode;
};

/**
 * Каркас приложения: боковое меню и рабочая область.
 * На широком экране меню стоит в потоке слева. На телефоне 256 px в потоке
 * съели бы больше половины экрана, поэтому там меню превращается в шторку
 * поверх страницы, а сверху появляется полоса с кнопкой-гамбургером.
 */
export default function AppShell({ items, children }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Переход по ссылке закрывает шторку — иначе она осталась бы поверх новой страницы.
  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const menu = (
    <div className="bb-card flex flex-col h-full overflow-hidden">
      <div className="h-16 flex items-center gap-3 px-5 shrink-0">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-2xl text-base"
          style={{ background: 'var(--aqua-400)', boxShadow: 'var(--glow-aqua)' }}
        >
          ✨
        </div>
        <span className="bb-title text-[16px]">AutoPost</span>
      </div>

      <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto">
        {items.map(item => (
          <NavLink key={item.href} href={item.href} icon={item.icon} label={item.label} />
        ))}

        <div className="pt-5 pb-1 px-3">
          <span
            className="text-[11px] font-extrabold uppercase tracking-wider"
            style={{ color: 'var(--ink-300)' }}
          >
            Автоматизация
          </span>
        </div>
        <NavLink href="/scheduled" icon="💬" label="Расписание WA" />
      </nav>
    </div>
  );

  return (
    // 100dvh, а не 100vh: на телефоне адресная строка съезжает, и vh даёт лишнюю прокрутку.
    <div className="flex h-[100dvh] w-full overflow-hidden relative">
      {/* Мягкие цветные пятна — дают глубину, но не отвлекают */}
      <div
        className="absolute -top-[15%] -left-[5%] w-[45%] h-[45%] rounded-full blur-[130px] pointer-events-none"
        style={{ background: 'rgba(45, 212, 191, .30)' }}
      />
      <div
        className="absolute -bottom-[15%] -right-[5%] w-[45%] h-[45%] rounded-full blur-[130px] pointer-events-none"
        style={{ background: 'rgba(253, 205, 211, .38)' }}
      />

      {/* ── Боковое меню: широкий экран ── */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col z-20 p-3">
        {menu}
      </aside>

      {/* ── Боковое меню: телефон, шторка поверх страницы ── */}
      <div
        className={`md:hidden fixed inset-0 z-40 ${open ? '' : 'pointer-events-none'}`}
        aria-hidden={!open}
      >
        <div
          onClick={() => setOpen(false)}
          className={`absolute inset-0 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0'}`}
          style={{ background: 'rgba(15, 43, 61, .35)' }}
        />
        <div
          className={`absolute inset-y-0 left-0 w-[17rem] max-w-[85%] p-3 transition-transform duration-300
                      ${open ? 'translate-x-0' : '-translate-x-full'}`}
          style={{ transitionTimingFunction: 'var(--swift)' }}
        >
          {menu}
        </div>
      </div>

      {/* ── Основная область ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden z-10">
        <header className="md:hidden flex items-center gap-3 h-14 shrink-0 px-3">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Открыть меню"
            className="bb-card h-10 w-10 shrink-0 flex items-center justify-center text-lg active:scale-95 transition-transform"
          >
            ☰
          </button>
          <span className="bb-title text-[16px]">AutoPost</span>
        </header>

        <main className="flex-1 overflow-auto overflow-x-hidden p-3 md:p-6 md:pl-3">
          {children}
        </main>
      </div>
    </div>
  );
}
