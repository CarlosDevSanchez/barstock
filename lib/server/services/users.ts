import 'server-only'
import { serverEnv } from '@/lib/env/server'
import { conflict, assertNoError, notFound, unprocessable, AppError } from '@/lib/server/errors'
import type { AppSupabaseClient } from '@/lib/server/supabase'
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin'
import { pageRange, type Pagination } from '@/lib/validation/common'
import type { InviteUserInput, UpdateUserInput } from '@/lib/validation/resources'
import type { Tables } from '@/types/database'
import { searchFilter, type Page } from './_shared'

export type UserListItem = Pick<Tables<'profiles'>, 'id' | 'email' | 'full_name' | 'role' | 'is_active' | 'created_at'>
const COLUMNS = 'id, email, full_name, role, is_active, created_at'

export async function listUsers(
    supabase: AppSupabaseClient,
    { page, pageSize, q }: Pagination
): Promise<Page<UserListItem>> {
    let query = supabase.from('profiles').select(COLUMNS, { count: 'exact' }).order('created_at', { ascending: true })
    const filter = searchFilter(q, ['email', 'full_name'])
    if (filter) query = query.or(filter)

    const { from, to } = pageRange({ page, pageSize })
    const { data, count, error } = await query.range(from, to)
    assertNoError(error)
    return { rows: data, total: count ?? 0 }
}

/**
 * Invites a user by email. The role goes into `app_metadata` (only the server can write it); a database trigger copies it
 * to the profile and activates it. The service_role client is used here and nowhere else.
 */
export async function inviteUser(supabase: AppSupabaseClient, input: InviteUserInput): Promise<UserListItem> {
    const admin = createSupabaseAdminClient()

    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(input.email, {
        data: input.full_name ? { full_name: input.full_name } : undefined,
        redirectTo: `${serverEnv.APP_URL}/auth/confirm`
    })
    if (inviteError || !invited.user) {
        if (inviteError?.code === 'email_exists' || inviteError?.status === 422) {
            throw conflict('A user with this email already exists')
        }
        console.error('[users] invite failed', inviteError)
        throw new AppError('internal_error', 'The invitation could not be sent')
    }

    const { error: roleError } = await admin.auth.admin.updateUserById(invited.user.id, {
        app_metadata: { role: input.role }
    })
    if (roleError) {
        // Do not leave a user behind without the intended role.
        await admin.auth.admin.deleteUser(invited.user.id)
        console.error('[users] role assignment failed', roleError)
        throw new AppError('internal_error', 'The invitation could not be completed')
    }

    const { data, error } = await supabase.from('profiles').select(COLUMNS).eq('id', invited.user.id).single()
    assertNoError(error)
    return data
}

/** The database trigger enforces "only admins" and "never the last active admin"; this adds "not yourself". */
export async function updateUser(
    supabase: AppSupabaseClient,
    actorId: string,
    id: string,
    patch: UpdateUserInput
): Promise<UserListItem> {
    if (id === actorId && (patch.is_active === false || (patch.role !== undefined && patch.role !== 'admin'))) {
        throw unprocessable('You cannot deactivate yourself or remove your own admin role')
    }
    const { data, error } = await supabase.from('profiles').update(patch).eq('id', id).select(COLUMNS).maybeSingle()
    assertNoError(error)
    if (!data) throw notFound('User not found')
    return data
}
