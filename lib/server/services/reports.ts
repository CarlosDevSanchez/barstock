import 'server-only'
import { assertNoError } from '@/lib/server/errors'
import type { AppSupabaseClient } from '@/lib/server/supabase'
import { businessDayReportSchema, type BusinessDayReport } from '@/lib/validation/cash'
import {
    dashboardSummarySchema,
    salesReportSchema,
    type DashboardSummary,
    type SalesReport
} from '@/lib/validation/reports'

// The time zone is read from `settings` inside the SQL functions (default UTC).
export async function getDashboardSummary(supabase: AppSupabaseClient): Promise<DashboardSummary> {
    const { data, error } = await supabase.rpc('dashboard_summary', {})
    assertNoError(error)
    return dashboardSummarySchema.parse(data)
}

export async function getSalesReport(supabase: AppSupabaseClient, from: string, to: string): Promise<SalesReport> {
    const { data, error } = await supabase.rpc('sales_report', { p_from: from, p_to: to })
    assertNoError(error)
    return salesReportSchema.parse(data)
}

export async function getBusinessDayReport(supabase: AppSupabaseClient, id: string): Promise<BusinessDayReport> {
    const { data, error } = await supabase.rpc('business_day_report', { p_business_day_id: id })
    assertNoError(error)
    return businessDayReportSchema.parse(data)
}
