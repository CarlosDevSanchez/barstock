import type { SessionUser } from '@/components/session-provider'
import { apiPost } from './client'

export const authApi = {
    login: (body: { email: string; password: string }) => apiPost<SessionUser>('auth/login', body),
    logout: () => apiPost('auth/logout'),
    forgotPassword: (email: string) => apiPost('auth/password/forgot', { email }),
    resetPassword: (password: string) => apiPost('auth/password/reset', { password })
}
