import { ensureTestUsers, requireLocalSupabase } from '../test/helpers/integration'

// Fails fast (and refuses a non-local project) before a browser is started.
export default async function globalSetup() {
    await requireLocalSupabase()
    await ensureTestUsers()
}
