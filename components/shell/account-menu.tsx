'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { apiPatch, apiPost, errorMessage } from '@/lib/api/client'
import { notificationsApi } from '@/lib/api/notifications'
import { idbClearSnapshot } from '@/lib/offline/db'
import { pendingOutboxCount } from '@/lib/offline/outbox'
import { clearOfflineCaches } from '@/lib/pwa/clear-cache'
import { APP_LOCALES, type AppLocale } from '@/lib/i18n/config'
import { useCartStore } from '@/stores/cart'
import type { SessionUser } from '@/components/session-provider'
import { cn } from '@/lib/utils'
import { Moon, Sun, LogOut } from 'lucide-react'

interface AccountMenuProps {
    user: SessionUser
    className?: string
    /** `icon`: bare avatar trigger for the top bar. `full`: avatar + name + role row for the sidebar footer. */
    variant?: 'icon' | 'full'
}

function isIos(): boolean {
    if (typeof navigator === 'undefined') return false
    return (
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    )
}

function isStandalone(): boolean {
    if (typeof window === 'undefined') return false
    const media = window.matchMedia('(display-mode: standalone)').matches
    const safari = 'standalone' in navigator && Boolean((navigator as { standalone?: boolean }).standalone)
    return media || safari
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const raw = atob(base64)
    const output = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
    return output
}

export function AccountMenu({ user, className, variant = 'icon' }: AccountMenuProps) {
    const router = useRouter()
    const { theme, setTheme } = useTheme()
    const t = useTranslations('common')
    const tn = useTranslations('notifications')
    const clearCart = useCartStore(state => state.clearCart)
    const displayName = user.fullName || user.email
    const [pendingLogoutWarning, setPendingLogoutWarning] = useState<number | null>(null)
    const [notifyEmail, setNotifyEmail] = useState(user.notifyEmail)
    const [notifyPush, setNotifyPush] = useState(user.notifyPush)
    const [prefsBusy, setPrefsBusy] = useState(false)

    const doLogout = async () => {
        try {
            await apiPost('auth/logout')
        } catch {
            toast.error(t('signOutFailed'))
            return
        }
        // The cart belongs to the session: never leave it behind for the next person at this till.
        clearCart()
        // Same reason, for a shared/kiosk device: the POS snapshot is per-session, not per-device. The offline
        // sale queue (lib/offline/outbox.ts) is NOT cleared here: it belongs to the user, not the device, and is
        // sent the next time they sign back in (see the confirmation below).
        await Promise.all([clearOfflineCaches(), idbClearSnapshot()])
        router.push('/login')
        router.refresh()
    }

    // Unsynced offline sales (F3) stay queued through a logout, but the cashier should know they are there before
    // walking away from this device. Own entries only: a different user's leftovers on a shared device are not
    // this cashier's to know about (and the sync center itself hides them the same way — F4).
    const handleLogoutClick = async () => {
        const pending = await pendingOutboxCount(user.id)
        if (pending > 0) {
            setPendingLogoutWarning(pending)
            return
        }
        await doLogout()
    }

    const setLocale = async (locale: AppLocale) => {
        if (locale === user.locale) return
        try {
            await apiPatch('me', { locale })
            router.refresh()
        } catch (error: unknown) {
            toast.error(errorMessage(error))
        }
    }

    const savePrefs = async (email: boolean, push: boolean) => {
        setPrefsBusy(true)
        try {
            await notificationsApi.updatePrefs({ notify_email: email, notify_push: push })
            setNotifyEmail(email)
            setNotifyPush(push)
            router.refresh()
        } catch (error: unknown) {
            toast.error(errorMessage(error, tn('prefsFailed')))
            throw error
        } finally {
            setPrefsBusy(false)
        }
    }

    const toggleEmail = async () => {
        const next = !notifyEmail
        try {
            await savePrefs(next, notifyPush)
        } catch {
            /* toast already shown */
        }
    }

    const togglePush = async () => {
        if (notifyPush) {
            try {
                const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.ready : null
                const sub = await reg?.pushManager.getSubscription()
                if (sub) {
                    await notificationsApi.unsubscribe(sub.endpoint)
                    await sub.unsubscribe()
                }
                await savePrefs(notifyEmail, false)
            } catch (error: unknown) {
                toast.error(errorMessage(error, tn('prefsFailed')))
            }
            return
        }

        if (isIos() && !isStandalone()) {
            toast.message(tn('installForPush'))
            return
        }

        try {
            if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
                toast.error(tn('pushFailed'))
                return
            }
            const permission = await Notification.requestPermission()
            if (permission !== 'granted') {
                toast.error(tn('pushDenied'))
                return
            }
            const { publicKey } = await notificationsApi.getPushKey()
            const reg = await navigator.serviceWorker.ready
            const sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource
            })
            const json = sub.toJSON()
            if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
                toast.error(tn('pushFailed'))
                return
            }
            await notificationsApi.subscribe({
                endpoint: json.endpoint,
                p256dh: json.keys.p256dh,
                auth: json.keys.auth,
                user_agent: navigator.userAgent
            })
            await savePrefs(notifyEmail, true)
        } catch (error: unknown) {
            toast.error(errorMessage(error, tn('pushFailed')))
        }
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                {variant === 'full' ? (
                    <Button
                        variant="ghost"
                        className={cn('w-full justify-start gap-3 px-2', className)}
                        aria-label={t('accountMenu')}
                    >
                        <Avatar>
                            <AvatarFallback className="bg-sidebar-accent text-sidebar-accent-foreground">
                                {displayName.charAt(0).toUpperCase()}
                            </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col items-start text-sm group-data-[collapsible=icon]:hidden">
                            <span className="font-medium truncate max-w-32">{displayName}</span>
                            <span className="text-xs text-muted-foreground">{t(`role.${user.role}`)}</span>
                        </div>
                    </Button>
                ) : (
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn('size-9 rounded-full', className)}
                        aria-label={t('accountMenu')}
                    >
                        <Avatar className="size-9">
                            <AvatarFallback className="bg-sidebar-accent text-sidebar-accent-foreground">
                                {displayName.charAt(0).toUpperCase()}
                            </AvatarFallback>
                        </Avatar>
                    </Button>
                )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>{displayName}</DropdownMenuLabel>
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground -mt-2">
                    {t(`role.${user.role}`)}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    {t('language')}
                </DropdownMenuLabel>
                {APP_LOCALES.map(locale => (
                    <DropdownMenuItem
                        key={locale}
                        onClick={() => setLocale(locale)}
                        className={cn(user.locale === locale && 'font-medium text-sidebar-primary')}
                    >
                        {locale === 'es' ? 'Español' : 'English'}
                    </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    {tn('title')}
                </DropdownMenuLabel>
                <DropdownMenuItem
                    disabled={prefsBusy}
                    onSelect={e => {
                        e.preventDefault()
                        void toggleEmail()
                    }}
                    className="justify-between"
                >
                    <span>{tn('email')}</span>
                    <input
                        type="checkbox"
                        role="switch"
                        aria-checked={notifyEmail}
                        checked={notifyEmail}
                        readOnly
                        className="h-4 w-4 accent-emerald-600 pointer-events-none"
                    />
                </DropdownMenuItem>
                <DropdownMenuItem
                    disabled={prefsBusy}
                    onSelect={e => {
                        e.preventDefault()
                        void togglePush()
                    }}
                    className="justify-between"
                >
                    <span>{tn('push')}</span>
                    <input
                        type="checkbox"
                        role="switch"
                        aria-checked={notifyPush}
                        checked={notifyPush}
                        readOnly
                        className="h-4 w-4 accent-emerald-600 pointer-events-none"
                    />
                </DropdownMenuItem>
                {isIos() && !isStandalone() && (
                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground whitespace-normal">
                        {tn('installForPush')}
                    </DropdownMenuLabel>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                    {theme === 'dark' ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
                    {theme === 'dark' ? t('themeLight') : t('themeDark')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogoutClick} className="text-red-600">
                    <LogOut className="mr-2 h-4 w-4" />
                    {t('signOut')}
                </DropdownMenuItem>
            </DropdownMenuContent>
            <ConfirmDialog
                open={pendingLogoutWarning !== null}
                onOpenChange={open => !open && setPendingLogoutWarning(null)}
                title={t('logoutPendingTitle')}
                description={t('logoutPendingDescription', { count: pendingLogoutWarning ?? 0 })}
                confirmLabel={t('logoutPendingConfirm')}
                onConfirm={doLogout}
                destructive={false}
            />
        </DropdownMenu>
    )
}
