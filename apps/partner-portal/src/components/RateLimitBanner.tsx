'use client';
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

export function RateLimitBanner() {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    const onRateLimited = (e: Event) => {
      const retryAfter = (e as CustomEvent<{ retryAfter: number }>).detail.retryAfter;
      setSecondsLeft(retryAfter);
    };
    window.addEventListener('bx:rate-limited', onRateLimited);
    return () => window.removeEventListener('bx:rate-limited', onRateLimited);
  }, []);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [secondsLeft]);

  if (secondsLeft <= 0) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex items-center gap-3 bg-amber-500 px-6 py-3 text-white shadow-lg">
      <AlertTriangle className="w-5 h-5 shrink-0" />
      <div className="flex-1 text-sm font-medium">
        Too many requests — API calls paused. Resuming in{' '}
        <span className="font-bold">{secondsLeft}s</span>. Please wait.
      </div>
    </div>
  );
}
