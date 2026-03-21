'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authApi, brandingApi, BrandingConfig } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Zap } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [branding, setBranding] = useState<BrandingConfig>({ platformName: 'BusinessX', tagline: 'B2B Integration Platform', primaryColor: '#6366f1' });

  useEffect(() => {
    brandingApi.getPlatform()
      .then(r => {
        const b = (r.data as { data: BrandingConfig }).data;
        if (b) setBranding(b);
        if (b?.platformName) document.title = b.platformName;
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await authApi.login(email, password);
      localStorage.setItem('access_token', res.data.data.accessToken);
      router.push('/dashboard');
    } catch {
      setError('Invalid email or password.');
    } finally {
      setLoading(false);
    }
  };

  const bgColor = branding.primaryColor || '#6366f1';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-8">
        {/* Brand header */}
        <div className="text-center">
          <div
            className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4 overflow-hidden shadow-md"
            style={{ backgroundColor: bgColor }}
          >
            {branding.logoUrl
              ? <img src={branding.logoUrl} alt="logo" className="w-full h-full object-contain p-1" />
              : <Zap className="w-7 h-7 text-white" />}
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{branding.platformName || 'BusinessX'}</h1>
          <p className="text-gray-500 text-sm mt-1">{branding.tagline || 'B2B Integration Platform'}</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Sign in</h2>
            <p className="text-sm text-gray-500 mt-1">Welcome back to your partner portal</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input label="Username or Email" type="text" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin or you@company.com" required />
            <Input label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            <Button type="submit" className="w-full" size="lg" loading={loading}>Sign in</Button>
          </form>

          <p className="text-center text-sm text-gray-500">
            New partner?{' '}
            <Link href="/register" className="text-indigo-600 font-medium hover:underline">Register your company</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
