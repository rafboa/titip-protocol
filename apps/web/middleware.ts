import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkRateLimit } from './lib/rate-limit';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only apply rate limiting to /api routes
  if (!pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  // Exempt health checks
  if (pathname === '/api/health') {
    return NextResponse.next();
  }

  // Prefer headers set by the platform edge (not client-controllable) over the first
  // x-forwarded-for hop, which a caller can spoof to dodge the limit.
  const ip =
    request.headers.get('x-vercel-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    request.headers.get('x-forwarded-for')?.split(',').pop()?.trim() ||
    '127.0.0.1';

  let limit = 60; // default 60 requests per minute
  let windowMs = 60 * 1000;

  // /api/auth/session is called on every page load to restore the session, so it keeps the default.
  if (pathname.startsWith('/api/auth/') && pathname !== '/api/auth/session') {
    limit = 10;
  } else if (pathname === '/api/qris/parse') {
    limit = 20;
  } else if (pathname === '/api/escrow/create') {
    limit = 15;
  }

  let rateLimitKey = `${ip}:${pathname.split('/').slice(0, 4).join('/')}`;

  // Evidence uploads (up to ~4 MB each) are buffered in memory and stored in Postgres: keep them scarce.
  // Only the POST, and in its own bucket: the escrow page polls GETs under the same /api/escrow/:id key,
  // and those must not eat the upload budget (or the other way around).
  if (request.method === 'POST' && pathname.endsWith('/evidence')) {
    limit = 20;
    rateLimitKey = `${ip}:evidence-upload:${pathname.split('/')[3]}`;
  }
  const { allowed, retryAfter } = await checkRateLimit(rateLimitKey, limit, windowMs);

  if (!allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(limit),
          'X-RateLimit-Remaining': '0',
        },
      }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
