import React, { useState } from 'react';

interface LoginFormProps {
  onSubmit: (payload: { email: string; password: string }) => Promise<void> | void;
  onSwitchToRegister?: () => void;
  onForgot?: () => void;
}

export function LoginForm({ onSubmit, onSwitchToRegister, onForgot }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email) return setError('Email jest wymagany');
    if (!password) return setError('Hasło jest wymagane');
    setLoading(true);
    try {
      await onSubmit({ email, password });
    } catch (err: any) {
      setError(err?.message || 'Błąd logowania');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
          placeholder="you@example.com"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Hasło</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
        {loading ? 'Ładowanie...' : 'Zaloguj się'}
      </button>

      <div className="flex items-center justify-between text-sm">
        <button type="button" onClick={onForgot} className="text-green-600 hover:text-green-700">
          Zapomniałeś hasła?
        </button>
        <button type="button" onClick={onSwitchToRegister} className="text-green-600 hover:text-green-700">
          Załóż konto
        </button>
      </div>
    </form>
  );
}

export default LoginForm;

