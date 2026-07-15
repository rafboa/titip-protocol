'use client';

// NotificationBell — polls /api/user/:address/notifications every 30s.
// Opens a dropdown showing the 20 most recent notifications.
// Clicking the bell marks all unread as read (PATCH).
// Decision: custom popover via useRef + useEffect instead of shadcn Popover —
// shadcn Popover isn't installed yet; a native div with click-outside handling
// is simpler and avoids adding a new dep. // v1.1: migrate to shadcn Popover.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, Package, CheckCircle2, ShieldCheck, AlertCircle } from 'lucide-react';

import { useAuthStore } from '@/lib/store/auth';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// ─── Types ────────────────────────────────────────────────────────────────────

type NotificationRecord = {
  id: string;
  type: string;
  message: string;
  read: boolean;
  createdAt: string;
};

type NotificationsResponse = {
  notifications: NotificationRecord[];
  unreadCount: number;
};

// ─── Icon helper ──────────────────────────────────────────────────────────────

function notifIcon(type: string) {
  switch (type) {
    case 'ESCROW_CREATED':   return <Package   size={14} className="shrink-0 text-primary"  />;
    case 'ESCROW_FUNDED':    return <ShieldCheck size={14} className="shrink-0 text-success" />;
    case 'ESCROW_SHIPPED':   return <Package   size={14} className="shrink-0 text-secondary" />;
    case 'ESCROW_DELIVERED': return <CheckCircle2 size={14} className="shrink-0 text-success" />;
    case 'ESCROW_REFUNDED':  return <AlertCircle  size={14} className="shrink-0 text-warning" />;
    default:                 return <Bell       size={14} className="shrink-0 text-muted-foreground" />;
  }
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs / 60_000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'just now';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NotificationBell() {
  const { publicKey, isAuthenticated } = useAuthStore();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const { data } = useQuery<NotificationsResponse>({
    queryKey: ['notifications', publicKey],
    queryFn: async () => {
      const res = await fetch(`/api/user/${publicKey}/notifications`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('titip_jwt')}` },
      });
      if (!res.ok) throw new Error('Failed to fetch notifications');
      return res.json();
    },
    enabled: isAuthenticated && !!publicKey,
    refetchInterval: 30_000, // poll every 30 s
    staleTime: 20_000,
  });

  const markAllRead = useCallback(async () => {
    if (!publicKey || !data?.unreadCount) return;
    try {
      await fetch(`/api/user/${publicKey}/notifications`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${localStorage.getItem('titip_jwt')}` },
      });
      // Optimistic update — refetch in background
      await queryClient.invalidateQueries({ queryKey: ['notifications', publicKey] });
    } catch {
      // Non-critical — silently ignore
    }
  }, [publicKey, data?.unreadCount, queryClient]);

  const handleOpen = () => {
    setOpen((prev) => !prev);
    // Mark read when opening (fire-and-forget)
    if (!open) markAllRead();
  };

  if (!isAuthenticated) return null;

  const unread = data?.unreadCount ?? 0;
  const notifications = data?.notifications ?? [];

  return (
    <div ref={containerRef} className="relative">
      {/* Bell button */}
      <Button
        id="notification-bell-btn"
        variant="ghost"
        size="icon"
        onClick={handleOpen}
        aria-label={`Notifications${unread > 0 ? ` — ${unread} unread` : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        className="relative"
      >
        <Bell size={20} />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className={cn(
              'absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center',
              'rounded-full bg-destructive text-[10px] font-bold leading-none text-white',
              'animate-fade-in',
            )}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Button>

      {/* Dropdown panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className={cn(
            'glass absolute right-0 top-full z-50 mt-2 w-80 rounded-xl',
            'flex flex-col overflow-hidden shadow-2xl',
            'animate-fade-in',
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-semibold">Notifikasi</span>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-primary hover:underline"
              >
                Tandai semua terbaca
              </button>
            )}
          </div>

          {/* List */}
          <ul className="max-h-80 overflow-y-auto" role="list">
            {notifications.length === 0 ? (
              <li className="flex flex-col items-center gap-3 px-4 py-8 text-center text-muted-foreground">
                <BellOff size={28} className="opacity-40" />
                <span className="text-sm">Belum ada notifikasi</span>
              </li>
            ) : (
              notifications.map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    'flex gap-3 px-4 py-3 text-sm transition-colors hover:bg-white/5',
                    !n.read && 'bg-primary/5',
                  )}
                >
                  {/* type icon */}
                  <div className="mt-0.5">{notifIcon(n.type)}</div>

                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className={cn('leading-snug', !n.read && 'font-medium text-foreground')}>
                      {n.message}
                    </p>
                    <time
                      dateTime={n.createdAt}
                      className="text-xs text-muted-foreground"
                    >
                      {formatRelative(n.createdAt)}
                    </time>
                  </div>

                  {/* Unread dot */}
                  {!n.read && (
                    <span
                      aria-label="Unread"
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary"
                    />
                  )}
                </li>
              ))
            )}
          </ul>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="border-t border-border px-4 py-2.5 text-center text-xs text-muted-foreground">
              {notifications.length} notifikasi terbaru ditampilkan
            </div>
          )}
        </div>
      )}
    </div>
  );
}
