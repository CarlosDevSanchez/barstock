/**
 * Pure helpers for suggesting how to split an open tab's balance between people. This is a CLIENT-SIDE SUGGESTION
 * only: the database is the real barrier (`tab_pay` validates every payment against the live balance server-side),
 * so a bug here can never cause an overcharge — at worst it offers a share the server then rejects.
 */

export const toMinorUnits = (amount: number, decimals: number) => Math.round(amount * 10 ** decimals)
export const fromMinorUnits = (amountMinor: number, decimals: number) => amountMinor / 10 ** decimals

/**
 * Sums money amounts in minor units (cents) so the total is never off by a float-rounding cent, then converts
 * back. Used for on-screen aggregates (a pending receipt's outstanding balance, a customer's total receivables).
 */
export function sumMoney(amounts: number[], decimals: number): number {
    return fromMinorUnits(
        amounts.reduce((totalMinor, amount) => totalMinor + toMinorUnits(amount, decimals), 0),
        decimals
    )
}

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

/**
 * What the second payment should be so two amounts add up to `total`. Never negative: a first amount above the
 * total yields 0 and `paymentGap` reports the excess.
 */
export function splitRemainder(total: number, first: number, decimals: number): number {
    const rest = toMinorUnits(total, decimals) - toMinorUnits(first, decimals)
    return fromMinorUnits(Math.max(0, rest), decimals)
}

/**
 * `total` minus the sum of `amounts`, in minor units. Positive means the payments are short; negative means they
 * overshoot. Zero means they match the total exactly.
 */
export function paymentGap(total: number, amounts: number[], decimals: number): number {
    const sum = amounts.reduce((totalMinor, amount) => totalMinor + toMinorUnits(amount, decimals), 0)
    return fromMinorUnits(toMinorUnits(total, decimals) - sum, decimals)
}

export interface CashDifference {
    /** Amount handed back to the customer (0 if received ≤ due). */
    change: number
    /** Amount short (what the customer still owes; 0 if received ≥ due). */
    short: number
}

/**
 * Calculates change and shortage when cash is received. Works in minor units (cents-equivalent)
 * to avoid float noise. Exactly one of `change`/`short` is non-zero, or both are 0 when
 * `received === cashDue`.
 */
export function cashDifference(received: number, cashDue: number, decimals: 0 | 2): CashDifference {
    const receivedMinor = toMinorUnits(received, decimals)
    const dueMinor = toMinorUnits(cashDue, decimals)
    const deltaMinor = receivedMinor - dueMinor

    return {
        change: deltaMinor > 0 ? fromMinorUnits(deltaMinor, decimals) : 0,
        short: deltaMinor < 0 ? fromMinorUnits(-deltaMinor, decimals) : 0
    }
}

/** Cash handed back. Visual only: never sent to the server. Short cash shows 0. */
export function cashChange(received: number, cashDue: number, decimals: number): number {
    const { change } = cashDifference(received, cashDue, decimals as 0 | 2)
    return change
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
