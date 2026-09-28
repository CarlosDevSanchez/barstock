import { describe, expect, test } from 'bun:test'
import { dashboardSummarySchema, salesReportSchema } from './reports'

const dashboardBase = {
    time_zone: 'UTC',
    today_revenue: 0,
    today_orders: 0,
    month_revenue: 0,
    total_customers: 0,
    low_stock_count: 0,
    sales_last_7_days: [],
    top_products: [],
    low_stock_items: []
}

const salesReportBase = {
    from: '2026-01-01',
    to: '2026-01-31',
    time_zone: 'UTC',
    total_orders: 0,
    total_revenue: 0,
    total_tax: 0,
    total_discount: 0,
    average_order: 0,
    promo_markdown: 0,
    total_cogs: 0,
    gross_profit: 0,
    total_expenses: 0,
    expenses_by_category: [],
    net_profit: 0,
    daily: [],
    top_products: [],
    top_promotions: [],
    top_customers: [],
    by_payment_method: []
}

describe('D9/F4: reports schemas tolerate code deployed ahead of the phase-E migration', () => {
    test('dashboard_summary without receivables_total/receivables_overdue (pre-20261005000003) defaults to 0', () => {
        const result = dashboardSummarySchema.parse(dashboardBase)
        expect(result.receivables_total).toBe(0)
        expect(result.receivables_overdue).toBe(0)
    })

    test('sales_report without written_off_total (pre-20261005000003) defaults to 0', () => {
        const result = salesReportSchema.parse(salesReportBase)
        expect(result.written_off_total).toBe(0)
    })

    test('still uses the real values once the RPC returns them', () => {
        const result = dashboardSummarySchema.parse({
            ...dashboardBase,
            receivables_total: 15000,
            receivables_overdue: 5000
        })
        expect(result.receivables_total).toBe(15000)
        expect(result.receivables_overdue).toBe(5000)
    })
})
