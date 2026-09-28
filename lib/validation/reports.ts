import { z } from 'zod'

// Contract of the SQL reporting functions (dashboard_summary / sales_report). Parsed on the server so a drift between
// the SQL and the UI fails loudly there instead of rendering NaN.
const num = z.number()

export const dashboardSummarySchema = z.object({
    time_zone: z.string(),
    today_revenue: num,
    today_orders: num,
    month_revenue: num,
    total_customers: num,
    low_stock_count: num,
    sales_last_7_days: z.array(z.object({ date: z.string(), revenue: num, orders: num })),
    top_products: z.array(z.object({ product_id: z.string(), name: z.string(), quantity: num, revenue: num })),
    low_stock_items: z.array(
        z.object({
            inventory_id: z.string(),
            product_id: z.string(),
            product_name: z.string(),
            sku: z.string(),
            quantity: num,
            low_stock_threshold: num
        })
    ),
    /** Sum of balances on pending receivable orders. Added by phase E (20261005000003); optional so code deployed
     *  ahead of that migration degrades to "no receivables" instead of failing every dashboard load (D9/F4). */
    receivables_total: num.default(0),
    /** Pending balances whose due_date is before today in the store time zone. Same D9/F4 tolerance as above. */
    receivables_overdue: num.default(0)
})
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>

export const salesReportSchema = z.object({
    from: z.string(),
    to: z.string(),
    time_zone: z.string(),
    total_orders: num,
    total_revenue: num,
    total_tax: num,
    total_discount: num,
    average_order: num,
    /** List-price equivalent minus assigned base on promo lines (current catalog selling_price). */
    promo_markdown: num,
    /** Σ qty × cost snapshotted on the line, or the current catalog cost when the line has none. */
    total_cogs: num,
    /** Σ line bases (unit_price×qty − discount) − total_cogs. */
    gross_profit: num,
    total_expenses: num,
    expenses_by_category: z.array(z.object({ category: z.string(), total: num })),
    /** Remaining (uncollected) balance of written_off orders whose written_off_at falls in the range. Shown for
     *  visibility only — it is not subtracted from net_profit (see C1, H6). Added by phase E; optional so code
     *  deployed ahead of that migration degrades to 0 instead of failing the whole report (D9/F4). */
    written_off_total: num.default(0),
    /** gross_profit + (payments collected on written-off orders, on their own date) − total_discount −
     *  total_expenses − (cost of goods for written-off orders in range). */
    net_profit: num,
    daily: z.array(z.object({ date: z.string(), revenue: num, orders: num })),
    top_products: z.array(
        z.object({
            product_id: z.string(),
            name: z.string(),
            quantity: num,
            revenue: num,
            cogs: num,
            gross_profit: num
        })
    ),
    top_promotions: z.array(
        z.object({
            promotion_id: z.string(),
            name: z.string(),
            orders: num,
            packages: num,
            revenue: num
        })
    ),
    top_customers: z.array(z.object({ customer_id: z.string(), name: z.string(), orders: num, spent: num })),
    by_payment_method: z.array(z.object({ method: z.string(), orders: num, amount: num }))
})
export type SalesReport = z.infer<typeof salesReportSchema>
