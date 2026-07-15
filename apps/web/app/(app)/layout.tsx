import { Navbar } from '@/components/layout/navbar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      <Navbar />
      {children}
    </div>
  );
}
