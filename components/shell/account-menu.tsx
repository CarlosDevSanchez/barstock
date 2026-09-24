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

export function AccountMenu({ user, className, variant = 'icon' }: AccountMenuProps) {
    const router = useRouter()
    const { theme, setTheme } = useTheme()
    const t = useTranslations('common')
    const clearCart = useCartStore(state => state.clearCart)
    const displayName = user.fullName || user.email
    const [pendingLogoutWarning, setPendingLogoutWarning] = useState<number | null>(null)

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
    // walking away from this device.
    const handleLogoutClick = async () => {
        const pending = await pendingOutboxCount()
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
