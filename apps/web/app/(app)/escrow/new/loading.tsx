import { Skeleton } from '@/components/ui/skeleton';

export default function CreateEscrowLoading() {
  return (
    <main className="container max-w-2xl py-16">
      <Skeleton className="mb-2 h-10 w-64" />
      <Skeleton className="mb-12 h-5 w-80" />
      <Skeleton className="h-64 w-full" />
    </main>
  );
}
