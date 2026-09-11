import ChangePasswordForm from './ChangePasswordForm';

export default function ChangePasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--sky-100)' }}>
      <div className="w-full max-w-sm bg-white p-8 rounded-2xl shadow-sm border">
        <h1 className="text-xl font-semibold mb-1">Смена пароля</h1>
        <p className="text-sm text-gray-500 mb-6">Задайте свой постоянный пароль вместо временного.</p>
        <ChangePasswordForm />
      </div>
    </div>
  );
}
