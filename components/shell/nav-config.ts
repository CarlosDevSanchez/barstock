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
    FolderTree,
    Gift,
    UserCog,
    ScrollText,
    Banknote,
    Receipt,
    HandCoins
} from 'lucide-react'
import type { UserRole } from '@/lib/auth/roles'

export type NavKey =
    | 'dashboard'
    | 'pos'
    | 'cash'
    | 'products'
    | 'categories'
    | 'promotions'
    | 'inventory'
    | 'orders'
    | 'receivables'
    | 'customers'
    | 'suppliers'
    | 'reports'
    | 'expenses'
    | 'settings'
    | 'users'
    | 'audit'

export interface NavItem {
    icon: typeof LayoutDashboard
    href: string
    minimumRole: UserRole
    key: NavKey
}

export interface NavGroup {
    key: 'sales' | 'catalog' | 'analytics' | 'admin'
    items: NavItem[]
}

export const navGroups: NavGroup[] = [
    {
        key: 'sales',
        items: [
            { icon: LayoutDashboard, key: 'dashboard', href: '/dashboard', minimumRole: 'cashier' },
            { icon: ShoppingCart, key: 'pos', href: '/pos', minimumRole: 'cashier' },
            { icon: Banknote, key: 'cash', href: '/cash', minimumRole: 'cashier' },
            { icon: ShoppingBag, key: 'orders', href: '/orders', minimumRole: 'cashier' },
            { icon: HandCoins, key: 'receivables', href: '/receivables', minimumRole: 'cashier' },
            { icon: Users, key: 'customers', href: '/customers', minimumRole: 'cashier' }
        ]
    },
    {
        key: 'catalog',
        items: [
            { icon: Package, key: 'products', href: '/products', minimumRole: 'cashier' },
            { icon: FolderTree, key: 'categories', href: '/categories', minimumRole: 'cashier' },
            { icon: Gift, key: 'promotions', href: '/promotions', minimumRole: 'manager' },
            { icon: Warehouse, key: 'inventory', href: '/inventory', minimumRole: 'cashier' },
            { icon: Truck, key: 'suppliers', href: '/suppliers', minimumRole: 'manager' }
        ]
    },
    {
        key: 'analytics',
        items: [
            { icon: BarChart3, key: 'reports', href: '/reports', minimumRole: 'manager' },
            { icon: Receipt, key: 'expenses', href: '/expenses', minimumRole: 'manager' }
        ]
    },
    {
        key: 'admin',
        items: [
            { icon: Settings2, key: 'settings', href: '/settings', minimumRole: 'admin' },
            { icon: UserCog, key: 'users', href: '/users', minimumRole: 'admin' },
            { icon: ScrollText, key: 'audit', href: '/audit', minimumRole: 'admin' }
        ]
    }
]

/** All mobile tabs are `cashier`-level, so every role sees the same four bottom-nav destinations. */
export const mobileTabKeys: NavKey[] = ['dashboard', 'orders', 'pos', 'inventory']

const allItems = navGroups.flatMap(group => group.items)

/** Matches by prefix so a detail route like `/orders/123` still highlights the `orders` nav entry. */
export function findNavItem(pathname: string): NavItem | undefined {
    return allItems.find(item => pathname === item.href || pathname.startsWith(`${item.href}/`))
}
