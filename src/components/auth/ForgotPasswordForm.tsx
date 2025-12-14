import React, { useState } from 'react';

interface ForgotPasswordProps {
  onSubmit: (payload: { email: string }) => Promise<void> | void;
}

export function ForgotPasswordForm({ onSubmit }: ForgotPasswordProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!email) return setError('Email jest wymagany');
    setLoading(true);
    try {
      await onSubmit({ email });
      setMessage('Jeśli konto istnieje, otrzymasz wiadomość e-mail z instrukcjami resetu.');
    } catch (err: any) {
      setError(err?.message || 'Błąd wysyłania wiadomości');
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

      {error && <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}
      {message && <div className="bg-green-50 text-green-700 px-4 py-3 rounded-lg text-sm">{message}</div>}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 px-4 rounded-lg transition disabled:opacity-50"
      >
        {loading ? 'Wysyłanie...' : 'Wyślij instrukcje resetu'}
      </button>
    </form>
  );
}

export default ForgotPasswordForm;

