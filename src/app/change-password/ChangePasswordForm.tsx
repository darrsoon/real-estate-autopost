'use client';
import { useActionState } from 'react';
import { changePasswordAction, ChangePasswordState } from './actions';

const initialState: ChangePasswordState = {};

export default function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePasswordAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Текущий (временный) пароль</label>
        <input name="current" type="password" required className="w-full px-3 py-2 border rounded-xl text-sm" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Новый пароль</label>
        <input name="next1" type="password" required minLength={8} className="w-full px-3 py-2 border rounded-xl text-sm" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Повторите новый пароль</label>
        <input name="next2" type="password" required minLength={8} className="w-full px-3 py-2 border rounded-xl text-sm" />
      </div>
      {state?.error ? <p className="text-red-600 text-sm">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full py-2 rounded-xl bg-black text-white text-sm font-medium disabled:opacity-50"
      >
        {pending ? 'Сохраняем…' : 'Сменить пароль'}
      </button>
    </form>
  );
}
