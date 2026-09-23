'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { apiPatch, apiPost, errorMessage } from '@/lib/api/client'
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

    const handleLogout = async () => {
        try {
            await apiPost('auth/logout')
        } catch {
            toast.error(t('signOutFailed'))
            return
        }
        // The cart belongs to the session: never leave it behind for the next person at this till.
        clearCart()
        // Same reason, for a shared/kiosk device: the offline caches are per-session, not per-device.
        await clearOfflineCaches()
        router.push('/login')
        router.refresh()
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
                <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                    <LogOut className="mr-2 h-4 w-4" />
                    {t('signOut')}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
