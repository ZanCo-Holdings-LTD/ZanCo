'use client';

import { useState } from 'react';
import { browserClient } from '@/lib/supabase/browser';

export function SignInForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState('sending');

    const { error } = await browserClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    setState(error ? 'error' : 'sent');
  }

  if (state === 'sent') {
    return (
      <p className="rounded border border-neutral-200 bg-white p-4 text-sm">
        Check <strong>{email}</strong> for a sign-in link.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label htmlFor="email" className="block text-sm font-medium">
        Email
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={state === 'sending'}
        className="w-full rounded bg-ink px-4 py-2 text-sm font-medium text-white disabled:bg-neutral-300"
      >
        {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
      </button>
      {state === 'error' && (
        <p className="text-sm text-red-700">Could not send the link. Please try again.</p>
      )}
    </form>
  );
}
