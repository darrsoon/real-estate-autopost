import type { Metadata } from 'next';
import { Nunito } from 'next/font/google';
import './globals.css';
import AppShell from '@/components/AppShell';
import { getSession } from '@/lib/auth/session';

// Круглый дружелюбный гротеск — на нём держится вся «мультяшность».
const nunito = Nunito({
  variable: '--font-sans',
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '600', '700', '800'],
});

export const metadata: Metadata = {
  title: 'Real Estate AutoPost',
  description: 'Automated real estate publishing',
};

const navItems = [
  { href: '/manual-post', label: 'Посты', icon: '✏️' },
  { href: '/budget', label: 'Рассылки', icon: '💰' },
  { href: '/catalog', label: 'Каталог', icon: '📄' },
  { href: '/drive-audit', label: 'Аудит Drive', icon: '📂' },
  { href: '/wa-monitor', label: 'WA Монитор', icon: '📌' },
  { href: '/plan-crop', label: 'Кадр планировок', icon: '🖼️' },
  { href: '/project-emoji', label: 'Проекты', icon: '🎨' },
  { href: '/no-posts', label: 'Юниты без постов', icon: '📝' },
  { href: '/broker-check', label: 'Сверка брокеров', icon: '🤝' },
  { href: '/stories', label: 'Сторис Наташе', icon: '📸' },
  { href: '/news', label: 'Новости', icon: '📰' },
];

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();
  const items = [...navItems];
  if (session?.role === 'admin') {
    items.push({ href: '/admin/users', label: 'Пользователи', icon: '👤' });
  }
  if (session) {
    items.push({ href: '/logout', label: 'Выйти', icon: '🚪' });
  }

  return (
    <html lang="ru">
      <body
        className={`${nunito.variable} font-sans antialiased`}
        style={{ background: 'var(--sky-100)', color: 'var(--ink-900)' }}
      >
        <AppShell items={items}>{children}</AppShell>
      </body>
    </html>
  );
}
