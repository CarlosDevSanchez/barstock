import { expect, test } from '@playwright/test'
import { confirmLinkIn, uniq, waitForEmail } from '../test/helpers/integration'
import { navLinks, newSession, pinEnglish, signInWith, forceEnglishUi } from './helpers'

test('an admin invites a cashier, who accepts by email, chooses a password and lands with the right access', async ({
    browser
}) => {
    const email = `${uniq('new-cashier')}@barstock.test`
    const admin = await newSession(browser, 'admin')
    await admin.goto('/users')
    await admin.getByRole('button', { name: 'Invite user' }).click()
    await admin.getByLabel('Email *').fill(email)
    await admin.getByLabel('Full name').fill('New Cashier')
    await admin.getByRole('button', { name: 'Send invitation' }).click()
    await expect(admin.locator('[data-sonner-toast]').filter({ hasText: `Invitation sent to ${email}` })).toBeVisible()
    // Users are listed oldest first, 10 per page: once the DB holds more than 10 profiles the invitee is not on page 1.
    await admin.getByPlaceholder('Search by name or email...').fill(email)
    await expect(admin.getByRole('row', { name: new RegExp(email) })).toContainText('Active')

    // The invitee opens the link from the email in their own browser.
    const link = confirmLinkIn((await waitForEmail(email)).html)
    const invitee = await (await browser.newContext()).newPage()
    await invitee.goto(link.toString())
    await invitee.waitForURL('**/reset-password')
    // New profiles default to es; e2e asserts English labels.
    await forceEnglishUi(invitee)

    await invitee.getByLabel('New password').fill('a-good-passphrase-1')
    await invitee.getByLabel('Confirm password').fill('a-different-one-2')
    await invitee.getByRole('button', { name: 'Save password' }).click()
    await expect(invitee.getByText('Passwords do not match')).toBeVisible()
    await invitee.getByLabel('Confirm password').fill('a-good-passphrase-1')
    await invitee.getByRole('button', { name: 'Save password' }).click()
    await invitee.waitForURL('**/dashboard')
    expect(await navLinks(invitee)).not.toContain('Settings')
    await invitee.goto('/users')
    await invitee.waitForURL('**/dashboard')

    // The link works once.
    const again = await (await browser.newContext()).newPage()
    await pinEnglish(again)
    await again.goto(link.toString())
    await again.waitForURL('**/login?error=invalid_link')
    await expect(again.getByText('invalid or has expired')).toBeVisible()

    // And they can sign in again with the password they chose.
    const fresh = await (await browser.newContext()).newPage()
    await signInWith(fresh, email, 'a-good-passphrase-1')
    await fresh.waitForURL('**/dashboard')
})

test('an admin can disable a user, who loses access immediately, and re-enable them', async ({ browser }) => {
    const email = `${uniq('to-disable')}@barstock.test`
    const admin = await newSession(browser, 'admin')
    await admin.goto('/users')
    await admin.getByRole('button', { name: 'Invite user' }).click()
    await admin.getByLabel('Email *').fill(email)
    await admin.getByRole('button', { name: 'Send invitation' }).click()
    const link = confirmLinkIn((await waitForEmail(email)).html)

    const user = await (await browser.newContext()).newPage()
    await user.goto(link.toString())
    await user.waitForURL('**/reset-password')
    await forceEnglishUi(user)
    await user.getByLabel('New password').fill('a-good-passphrase-1')
    await user.getByLabel('Confirm password').fill('a-good-passphrase-1')
    await user.getByRole('button', { name: 'Save password' }).click()
    await user.waitForURL('**/dashboard')

    await admin.getByPlaceholder('Search by name or email...').fill(email)
    const row = admin.getByRole('row', { name: new RegExp(email) })
    await row.getByRole('button', { name: 'Disable' }).click()
    await admin.getByRole('alertdialog').getByRole('button', { name: 'Disable' }).click()
    await expect(row).toContainText('Disabled')

    // Their open session is dead on the very next request.
    await user.goto('/products')
    await user.waitForURL('**/login**')

    await row.getByRole('button', { name: 'Enable' }).click()
    await admin.getByRole('alertdialog').getByRole('button', { name: 'Enable' }).click()
    await expect(row).toContainText('Active')
    await signInWith(user, email, 'a-good-passphrase-1')
    await user.waitForURL('**/dashboard')
})

test('forgot password: request, email, new password, sign in with it', async ({ browser }) => {
    // Use a throwaway account so the shared test users keep their password.
    const email = `${uniq('forgetful')}@barstock.test`
    const admin = await newSession(browser, 'admin')
    await admin.goto('/users')
    await admin.getByRole('button', { name: 'Invite user' }).click()
    await admin.getByLabel('Email *').fill(email)
    await admin.getByRole('button', { name: 'Send invitation' }).click()
    const invite = confirmLinkIn((await waitForEmail(email)).html)
    const first = await (await browser.newContext()).newPage()
    await first.goto(invite.toString())
    await first.waitForURL('**/reset-password')
    await forceEnglishUi(first)
    await first.getByLabel('New password').fill('the-first-password-1')
    await first.getByLabel('Confirm password').fill('the-first-password-1')
    await first.getByRole('button', { name: 'Save password' }).click()
    await first.waitForURL('**/dashboard')

    const page = await (await browser.newContext()).newPage()
    await pinEnglish(page)
    await page.goto('/forgot-password')
    await expect(page.getByRole('button', { name: 'Send reset link' })).toBeEnabled()
    await page.getByLabel('Email').fill(email)
    await page.getByRole('button', { name: 'Send reset link' }).click()
    await expect(page.getByText('a reset link is on its way')).toBeVisible()

    // The newest email for this address is the recovery one (the invitation arrived before it).
    const recovery = confirmLinkIn((await waitForLatestRecovery(email)).html)
    expect(recovery.searchParams.get('type')).toBe('recovery')
    await page.goto(recovery.toString())
    await page.waitForURL('**/reset-password')
    await forceEnglishUi(page)
    await page.getByLabel('New password').fill('the-second-password-2')
    await page.getByLabel('Confirm password').fill('the-second-password-2')
    await page.getByRole('button', { name: 'Save password' }).click()
    await page.waitForURL('**/dashboard')

    const check = await (await browser.newContext()).newPage()
    await signInWith(check, email, 'the-first-password-1')
    await expect(check.getByText('Invalid email or password')).toBeVisible()
    await signInWith(check, email, 'the-second-password-2')
    await check.waitForURL('**/dashboard')
})

async function waitForLatestRecovery(address: string) {
    const deadline = Date.now() + 10_000
    const base = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324'
    // Local stacks started before the ES templates still use the English subject.
    const recoverySubjects = new Set(['Reset your password', 'Restablece tu contraseña'])
    while (Date.now() < deadline) {
        const list = (await (await fetch(`${base}/api/v1/messages`)).json()) as {
            messages: Array<{ ID: string; Subject: string; To: Array<{ Address: string }> }>
        }
        const match = list.messages.find(
            message => recoverySubjects.has(message.Subject) && message.To.some(to => to.Address === address)
        )
        if (match) {
            const full = (await (await fetch(`${base}/api/v1/message/${match.ID}`)).json()) as { HTML: string }
            return { html: full.HTML }
        }
        await new Promise(resolve => setTimeout(resolve, 250))
    }
    throw new Error(`No recovery email for ${address}`)
}
