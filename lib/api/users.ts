import type { UserListItem } from '@/lib/server/services/users'
import type { InviteUserInput, UpdateUserInput } from '@/lib/validation/resources'
import { apiList, apiPatch, apiPost, type Query } from './client'

export type { UserListItem }

export const usersApi = {
    list: (query: Query, signal?: AbortSignal) => apiList<UserListItem>('users', query, signal),
    invite: (body: InviteUserInput) => apiPost<UserListItem>('users/invite', body),
    update: (id: string, body: UpdateUserInput) => apiPatch<UserListItem>(`users/${id}`, body)
}
