import { auth } from '@/auth'

export default auth((req) => {
  const isLogin = req.nextUrl.pathname.startsWith('/login')
  if (!req.auth && !isLogin) {
    return Response.redirect(new URL('/login', req.nextUrl.origin))
  }
})

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
}
