import { Skeleton } from '@/components/ui/skeleton';

export default function EscrowDetailLoading() {
  return (
    <main className="container max-w-3xl py-16">
      <div className="mb-8 flex items-center justify-between">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <Skeleton className="h-72 w-full" />
    </main>
  );
}
