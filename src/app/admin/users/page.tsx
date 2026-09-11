import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { listUsers } from '@/lib/auth/users';
import UsersTable from './UsersTable';
import AddUserForm from './AddUserForm';

export default async function UsersPage() {
  const session = await getSession();
  if (!session || session.role !== 'admin') redirect('/');
  const users = await listUsers();

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold mb-1">Пользователи</h1>
      <p className="text-sm text-gray-500 mb-6">Добавляй сотрудников и мгновенно закрывай доступ переключателем.</p>
      <AddUserForm />
      <div className="mt-8">
        <UsersTable users={users} currentUserId={session.uid} />
      </div>
    </div>
  );
}
