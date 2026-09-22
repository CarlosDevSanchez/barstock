/**
 * Pure helpers for suggesting how to split an open tab's balance between people. This is a CLIENT-SIDE SUGGESTION
 * only: the database is the real barrier (`tab_pay` validates every payment against the live balance server-side),
 * so a bug here can never cause an overcharge — at worst it offers a share the server then rejects.
 */

const toMinorUnits = (amount: number, decimals: number) => Math.round(amount * 10 ** decimals)
const fromMinorUnits = (amountMinor: number, decimals: number) => amountMinor / 10 ** decimals

/**
 * Splits `balance` into `n` equal-as-possible shares, working in the currency's smallest unit (`decimals`: 0 for
 * COP, 2 for USD) so the sum is always EXACTLY the balance — never off by a cent from float division. When it
 * doesn't divide evenly, the remainder is handed out one unit at a time to the first shares.
 */
export function splitEqual(balance: number, n: number, decimals: number): number[] {
    if (!Number.isInteger(n) || n <= 0) throw new Error('n must be a positive integer')
    const balanceMinor = toMinorUnits(balance, decimals)
    const base = Math.floor(balanceMinor / n)
    const remainder = balanceMinor - base * n
    return Array.from({ length: n }, (_, index) => fromMinorUnits(base + (index < remainder ? 1 : 0), decimals))
}

export interface CustomSplitCheck {
    /** Sum of every share entered so far. */
    sum: number
    /** What is still missing to cover the balance (negative when the shares add up to more than the balance). */
    remaining: number
    /** False once the shares add up to more than the balance; a sum below the balance is valid (paid later). */
    valid: boolean
}

/** Validates a "free amounts" split: the shares must not add up to more than the balance. */
export function validateCustom(amounts: number[], balance: number, decimals: number): CustomSplitCheck {
    const balanceMinor = toMinorUnits(balance, decimals)
    const sumMinor = amounts.reduce((total, amount) => total + toMinorUnits(amount, decimals), 0)
    return {
        sum: fromMinorUnits(sumMinor, decimals),
        remaining: fromMinorUnits(balanceMinor - sumMinor, decimals),
        valid: sumMinor <= balanceMinor
    }
}
