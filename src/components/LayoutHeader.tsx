import React, { useEffect, useState } from 'react';
import { LogOut, ChefHat } from 'lucide-react';
import { supabase } from '../lib/supabase';

export function LayoutHeader() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    // Determine logged-in state based on localStorage token or Supabase session
    const token = localStorage.getItem('access_token');
    if (token) {
      setLoggedIn(true);
      // Optionally, we can try to load user email from supabase session
      supabase.auth.getUser().then(({ data }) => {
        if (data?.user?.email) setEmail(data.user.email);
      }).catch(() => {});
    } else {
      setLoggedIn(false);
    }

    // Subscribe to supabase auth changes
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const tokenNow = session?.access_token ?? null;
      if (tokenNow) {
        localStorage.setItem('access_token', tokenNow);
        if (session?.user?.email) setEmail(session.user.email);
        setLoggedIn(true);
      } else {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        setLoggedIn(false);
        setEmail(null);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    try {
      // Attempt supabase signOut for completeness
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('supabase signOut failed', e);
    }
    // Clear tokens stored in localStorage
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    // Redirect to login
    window.location.href = '/auth/login';
  };

  return (
    <header className="bg-white shadow-sm border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ChefHat size={28} className="text-green-600" />
            <div>
              <h1 className="text-lg font-bold text-gray-900">Recipe Assistant</h1>
              {email && <p className="text-xs text-gray-500">{email}</p>}
            </div>
          </div>

          <div>
            {loggedIn ? (
              <button onClick={handleSignOut} className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition">
                <LogOut size={18} />
                Wyloguj
              </button>
            ) : (
              <a href="/auth/login" className="text-green-600 hover:text-green-700">Zaloguj</a>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

export default LayoutHeader;

