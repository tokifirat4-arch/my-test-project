import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'

export async function middleware(req) {
  const res      = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })
  const { data: { session } } = await supabase.auth.getSession()
  const { pathname } = req.nextUrl
  const publicPaths  = ['/login', '/exam']
  const isPublic     = publicPaths.some(p => pathname.startsWith(p))
  if (!session && !isPublic)
    return NextResponse.redirect(new URL('/login', req.url))
  if (session && pathname === '/login')
    return NextResponse.redirect(new URL('/dashboard', req.url))
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|opencv.js).*)'],
}
