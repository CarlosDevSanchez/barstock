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
    )
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
    daily: z.array(z.object({ date: z.string(), revenue: num, orders: num })),
    top_products: z.array(z.object({ product_id: z.string(), name: z.string(), quantity: num, revenue: num })),
    top_customers: z.array(z.object({ customer_id: z.string(), name: z.string(), orders: num, spent: num })),
    by_payment_method: z.array(z.object({ method: z.string(), orders: num, amount: num }))
})
export type SalesReport = z.infer<typeof salesReportSchema>
