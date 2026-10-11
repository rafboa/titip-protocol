import { Skeleton } from '@/components/ui/skeleton';

export default function SettingsLoading() {
  return (
    <main className="container py-16">
      <Skeleton className="mb-8 h-10 w-56" />
      <div className="grid gap-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    </main>
  );
}
