import React, { useState } from 'react';

interface RegisterFormProps {
  onSubmit: (payload: { email: string; password: string; displayName?: string }) => Promise<void> | void;
  onSwitchToLogin?: () => void;
}

function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Hasło musi mieć co najmniej 8 znaków';
  if (!/[A-Z]/.test(password)) return 'Hasło musi zawierać wielką literę';
  if (!/[a-z]/.test(password)) return 'Hasło musi zawierać małą literę';
  if (!/[0-9]/.test(password)) return 'Hasło musi zawierać cyfrę';
  return null;
}

export function RegisterForm({ onSubmit, onSwitchToLogin }: RegisterFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email) return setError('Email jest wymagany');
    const pwError = validatePassword(password);
    if (pwError) return setError(pwError);
    if (password !== confirm) return setError('Hasła nie są takie same');
    setLoading(true);
    try {
      await onSubmit({ email, password, displayName: displayName || undefined });
    } catch (err: any) {
      setError(err?.message || 'Błąd rejestracji');
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

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Wyświetlana nazwa (opcjonalnie)</label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
          placeholder="Jan Kowalski"
        />
      </div>

      {error && <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 px-4 rounded-lg transition disabled:opacity-50"
      >
        {loading ? 'Ładowanie...' : 'Zarejestruj się'}
      </button>

      <div className="text-center text-sm">
        <button type="button" onClick={onSwitchToLogin} className="text-green-600 hover:text-green-700">
          Masz już konto? Zaloguj się
        </button>
      </div>
    </form>
  );
}

export default RegisterForm;

