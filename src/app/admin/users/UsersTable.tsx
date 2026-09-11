'use client';
import { useTransition } from 'react';
import { toggleActiveAction, changeRoleAction } from './actions';
import { Role } from '@/lib/auth/users';

interface U {
  id: number;
  email: string;
  role: string;
  active: boolean;
  must_change_password: boolean;
  created_at: string;
}

export default function UsersTable({ users, currentUserId }: { users: U[]; currentUserId: number }) {
  const [pending, startTransition] = useTransition();

  return (
    <table className="w-full text-sm border-separate border-spacing-y-1">
      <thead>
        <tr className="text-left text-xs text-gray-500">
          <th className="px-3">Email</th>
          <th className="px-3">Роль</th>
          <th className="px-3">Доступ</th>
        </tr>
      </thead>
      <tbody>
        {users.map(u => (
          <tr key={u.id} className="bg-white">
            <td className="px-3 py-2 rounded-l-xl">{u.email}{u.id === currentUserId ? ' (вы)' : ''}</td>
            <td className="px-3 py-2">
              <select
                defaultValue={u.role}
                disabled={pending || u.id === currentUserId}
                onChange={e => startTransition(() => { changeRoleAction(u.id, e.target.value as Role); })}
                className="px-2 py-1 border rounded-lg text-xs"
              >
                <option value="editor">editor</option>
                <option value="admin">admin</option>
              </select>
            </td>
            <td className="px-3 py-2 rounded-r-xl">
              <button
                disabled={pending || u.id === currentUserId}
                onClick={() => startTransition(() => { toggleActiveAction(u.id, !u.active); })}
                className={`px-3 py-1 rounded-full text-xs font-medium ${u.active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}
              >
                {u.active ? '✅ включён' : '⛔ отключён'}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
