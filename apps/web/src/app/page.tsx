'use client';

import Image from 'next/image';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export default function HomePage() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading) {
      if (isAuthenticated) {
        router.push('/dashboard');
      } else {
        router.push('/login');
      }
    }
  }, [isAuthenticated, isLoading, router]);

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-slate-950">
      <div className="flex flex-col items-center gap-3">
        <div className="w-12 h-12 relative">
          <Image
            src="/brand/leadatlas-logo.jpg"
            alt="LeadAtlas"
            width={48}
            height={48}
            priority
            className="object-contain"
          />
        </div>
        <div className="text-xs text-slate-400 font-mono">Initializing LeadAtlas...</div>
      </div>
    </div>
  );
}
