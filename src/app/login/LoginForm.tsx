'use client';
import { useActionState } from 'react';
import { loginAction, LoginState } from './actions';

const initialState: LoginState = {};

export default function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label className="block text-sm font-medium mb-1">Email</label>
        <input
          name="email"
          type="email"
          required
          autoFocus
          className="w-full px-3 py-2 border rounded-xl text-sm"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Пароль</label>
        <input
          name="password"
          type="password"
          required
          className="w-full px-3 py-2 border rounded-xl text-sm"
        />
      </div>
      {state?.error ? <p className="text-red-600 text-sm">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full py-2 rounded-xl bg-black text-white text-sm font-medium disabled:opacity-50"
      >
        {pending ? 'Входим…' : 'Войти'}
      </button>
    </form>
  );
}
