import type { ReactNode } from 'react';
import { AppProviders } from '@/components/providers';
import { ServiceWorkerRegister } from '@/components/sw-register';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <AppProviders>
      {children}
      <ServiceWorkerRegister />
    </AppProviders>
  );
}
