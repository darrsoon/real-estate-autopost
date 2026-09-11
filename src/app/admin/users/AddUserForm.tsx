'use client';
import { useActionState } from 'react';
import { addUserAction, AddUserState } from './actions';

const initial: AddUserState = {};

export default function AddUserForm() {
  const [state, formAction, pending] = useActionState(addUserAction, initial);

  return (
    <div className="p-4 border rounded-2xl bg-white">
      <form action={formAction} className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="block text-xs font-medium mb-1">Email</label>
          <input name="email" type="email" required className="px-3 py-2 border rounded-xl text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Роль</label>
          <select name="role" className="px-3 py-2 border rounded-xl text-sm">
            <option value="editor">editor — публикует</option>
            <option value="admin">admin — полный доступ</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 rounded-xl bg-black text-white text-sm font-medium disabled:opacity-50"
        >
          {pending ? 'Добавляем…' : '+ Добавить'}
        </button>
      </form>
      {state?.error ? <p className="text-red-600 text-sm mt-2">{state.error}</p> : null}
      {state?.tempPassword ? (
        <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm">
          <p><b>{state.email}</b> добавлен(а). Временный пароль (покажется только один раз):</p>
          <p className="font-mono text-base mt-1 select-all">{state.tempPassword}</p>
          <p className="text-xs text-gray-500 mt-1">При первом входе будет предложено сразу его сменить.</p>
        </div>
      ) : null}
    </div>
  );
}
