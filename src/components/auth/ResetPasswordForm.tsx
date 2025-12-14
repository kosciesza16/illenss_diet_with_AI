import React, { useState } from 'react';

interface ResetPasswordFormProps {
  token?: string;
  onSubmit: (payload: { token: string; password: string }) => Promise<void> | void;
}

function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Hasło musi mieć co najmniej 8 znaków';
  if (!/[A-Z]/.test(password)) return 'Hasło musi zawierać wielką literę';
  if (!/[a-z]/.test(password)) return 'Hasło musi zawierać małą literę';
  if (!/[0-9]/.test(password)) return 'Hasło musi zawierać cyfrę';
  return null;
}

export function ResetPasswordForm({ token, onSubmit }: ResetPasswordFormProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const pwError = validatePassword(password);
    if (pwError) return setError(pwError);
    if (password !== confirm) return setError('Hasła nie są takie same');
    if (!token) return setError('Brakuje tokenu resetu');
    setLoading(true);
    try {
      await onSubmit({ token, password });
      setSuccess(true);
    } catch (err: any) {
      setError(err?.message || 'Błąd resetu hasła');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="bg-green-50 text-green-700 px-4 py-3 rounded-lg text-sm">
        Hasło zostało zresetowane. Możesz się teraz zalogować.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Nowe hasło</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
          placeholder="••••••••"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Powtórz hasło</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
          placeholder="••••••••"
        />
      </div>

      {error && <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 px-4 rounded-lg transition disabled:opacity-50"
      >
        {loading ? 'Wysyłanie...' : 'Zresetuj hasło'}
      </button>
    </form>
  );
}

export default ResetPasswordForm;

