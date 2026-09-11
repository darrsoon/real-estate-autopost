"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Props = {
  href: string;
  label: string;
  icon: string;
};

/** Пункт бокового меню. Подсвечивает текущий раздел и слегка отъезжает под курсором. */
export default function NavLink({ href, label, icon }: Props) {
  const pathname = usePathname();
  const active = pathname === href;

  return (
    <Link
      href={href}
      // Пунктов меню много, и без этого Next.js мгновенно префетчит ВСЕ разом —
      // это означало десяток параллельных обращений к middleware (и живому
      // запросу к базе внутри него) на каждую загрузку страницы. Под нагрузкой
      // часть таких фоновых запросов иногда обрывалась и попадала в кэш роутера
      // как редирект на /login — а при реальном клике Next отдавал уже
      // закэшированный (ошибочный) редирект, хотя сессия была рабочей.
      prefetch={false}
      className="group flex items-center gap-3 px-3 py-2.5 rounded-2xl text-sm font-bold
        transition-all duration-200 hover:translate-x-0.5"
      style={{
        background: active ? 'var(--sky-100)' : 'transparent',
        color: active ? 'var(--aqua-600)' : 'var(--ink-700)',
      }}
    >
      <span className="text-base transition-transform duration-200 group-hover:scale-110">
        {icon}
      </span>
      <span>{label}</span>
    </Link>
  );
}
