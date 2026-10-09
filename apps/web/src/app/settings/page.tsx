'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function SettingsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/settings/data-sources');
  }, [router]);

  return (
    <div className="p-8 text-center text-slate-400 text-sm">
      Redirecting to Data Sources settings...
    </div>
  );
}
