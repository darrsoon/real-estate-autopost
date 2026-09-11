import LoginForm from './LoginForm';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--sky-100)' }}>
      <div className="w-full max-w-sm bg-white p-8 rounded-2xl shadow-sm border">
        <h1 className="text-xl font-semibold mb-1">AutoPost</h1>
        <p className="text-sm text-gray-500 mb-6">Вход в приложение</p>
        <LoginForm next={next || '/'} />
      </div>
    </div>
  );
}
