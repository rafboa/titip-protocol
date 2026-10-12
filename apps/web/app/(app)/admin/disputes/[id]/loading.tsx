import { Skeleton } from '@/components/ui/skeleton';

export default function AdminDisputeLoading() {
  return (
    <main className="container max-w-3xl py-10 sm:py-16">
      <div className="mb-8 flex items-center justify-between gap-3">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-7 w-24" />
      </div>
      <Skeleton className="mb-8 h-64 w-full" />
      <Skeleton className="h-64 w-full" />
    </main>
  );
}
