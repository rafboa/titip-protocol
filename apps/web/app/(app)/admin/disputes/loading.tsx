import { Skeleton } from '@/components/ui/skeleton';

export default function AdminDisputesLoading() {
  return (
    <main className="container py-10 sm:py-16">
      <div className="mb-8 sm:mb-12">
        <Skeleton className="mb-2 h-10 w-64" />
        <Skeleton className="h-5 w-48" />
      </div>
      <div className="grid gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </main>
  );
}
