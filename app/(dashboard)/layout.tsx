'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth'
import { useTheme } from 'next-themes'
import {
    LayoutDashboard,
    ShoppingCart,
    Package,
    Warehouse,
    ShoppingBag,
    Users,
    Truck,
    BarChart3,
    Settings2,
    Menu,
    Moon,
    Sun,
    LogOut,
    User,
    FolderTree
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', href: '/dashboard' },
    { icon: ShoppingCart, label: 'POS', href: '/pos' },
    { icon: Package, label: 'Products', href: '/products' },
    { icon: FolderTree, label: 'Categories', href: '/categories' },
    { icon: Warehouse, label: 'Inventory', href: '/inventory' },
    { icon: ShoppingBag, label: 'Orders', href: '/orders' },
    { icon: Users, label: 'Customers', href: '/customers' },
    { icon: Truck, label: 'Suppliers', href: '/suppliers' },
    { icon: BarChart3, label: 'Reports', href: '/reports' },
    { icon: Settings2, label: 'Settings', href: '/settings' }
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter()
    const pathname = usePathname()
    const { user, setUser } = useAuthStore()
    const { theme, setTheme } = useTheme()
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const checkUser = async () => {
            const {
                data: { session }
            } = await supabase.auth.getSession()

            if (!session) {
                router.push('/login')
                return
            }

            const { data: profile } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()

            if (profile) {
                setUser(profile)
            }

            setLoading(false)
        }

        checkUser()
    }, [router, setUser])

    const handleLogout = async () => {
        await supabase.auth.signOut()
        setUser(null)
        router.push('/login')
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600"></div>
            </div>
        )
    }

    return (
        <div className="flex h-screen overflow-hidden">
            {/* Sidebar - Desktop */}
            <aside className="hidden lg:flex w-64 flex-col border-r bg-card">
                <div className="p-6">
                    <h1 className="text-2xl font-bold text-emerald-600">POS System</h1>
                </div>
                <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
                    {navItems.map(item => {
                        const Icon = item.icon
                        const isActive = pathname === item.href
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={cn(
                                    'flex items-center gap-3 px-4 py-3 rounded-xl transition-all',
                                    isActive
                                        ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-medium'
                                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                )}
                            >
                                <Icon className="w-5 h-5" />
                                {item.label}
                            </Link>
                        )
                    })}
                </nav>
                <div className="p-4 border-t">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="w-full justify-start gap-3">
                                <Avatar>
                                    <AvatarFallback className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                                        {user?.full_name?.charAt(0) || 'U'}
                                    </AvatarFallback>
                                </Avatar>
                                <div className="flex flex-col items-start text-sm">
                                    <span className="font-medium truncate max-w-32">{user?.full_name || 'User'}</span>
                                    <span className="text-xs text-muted-foreground capitalize">{user?.role}</span>
                                </div>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuLabel>My Account</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem>
                                <User className="mr-2 h-4 w-4" />
                                Profile
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                                {theme === 'dark' ? (
                                    <Sun className="mr-2 h-4 w-4" />
                                ) : (
                                    <Moon className="mr-2 h-4 w-4" />
                                )}
                                {theme === 'dark' ? 'Light' : 'Dark'} Mode
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                                <LogOut className="mr-2 h-4 w-4" />
                                Logout
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </aside>

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Header - Mobile */}
                <header className="lg:hidden flex items-center justify-between p-4 border-b bg-card">
                    <Sheet>
                        <SheetTrigger asChild>
                            <Button variant="ghost" size="icon">
                                <Menu className="h-6 w-6" />
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="left" className="w-64 p-0">
                            <div className="p-6">
                                <h1 className="text-2xl font-bold text-emerald-600">POS System</h1>
                            </div>
                            <nav className="px-4 space-y-1">
                                {navItems.map(item => {
                                    const Icon = item.icon
                                    const isActive = pathname === item.href
                                    return (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            className={cn(
                                                'flex items-center gap-3 px-4 py-3 rounded-xl transition-all',
                                                isActive
                                                    ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-medium'
                                                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                            )}
                                        >
                                            <Icon className="w-5 h-5" />
                                            {item.label}
                                        </Link>
                                    )
                                })}
                            </nav>
                        </SheetContent>
                    </Sheet>
                    <h1 className="text-xl font-bold text-emerald-600">POS System</h1>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                                <Avatar>
                                    <AvatarFallback className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                                        {user?.full_name?.charAt(0) || 'U'}
                                    </AvatarFallback>
                                </Avatar>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuLabel>My Account</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem>
                                <User className="mr-2 h-4 w-4" />
                                Profile
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                                {theme === 'dark' ? (
                                    <Sun className="mr-2 h-4 w-4" />
                                ) : (
                                    <Moon className="mr-2 h-4 w-4" />
                                )}
                                {theme === 'dark' ? 'Light' : 'Dark'} Mode
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                                <LogOut className="mr-2 h-4 w-4" />
                                Logout
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </header>

                {/* Main Content Area */}
                <main className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-900">{children}</main>
            </div>
        </div>
    )
}
