'use client'

import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { formatMoneyInput, parseMoneyInput } from '@/lib/money-input'

export interface MoneyInputProps {
    value: number | null
    onChange: (value: number | null) => void
    /** 0 for zero-decimal currencies (COP…), 2 otherwise — matches `currencyDecimals`. */
    decimals: 0 | 2
    /** BCP-47 tag, e.g. `moneyLocale(user.locale)`. */
    locale: string
    id?: string
    'aria-label'?: string
    className?: string
    disabled?: boolean
    placeholder?: string
}

/**
 * Controlled money input built on Task A's `parseMoneyInput`/`formatMoneyInput`: types like a normal text field
 * while focused (the raw string the person is typing is the source of truth, so "12," isn't snapped back to "12"
 * before they type the fraction), and only reformats with the locale's separators on blur or when `value` changes
 * from outside while the field isn't focused (e.g. a dialog clearing the field on open, or a "Todo el saldo"
 * button). Generic — no cart/tab-specific behavior — so it's reused by the payment dialog, and later the
 * receivables and tab dialogs.
 */
export function MoneyInput({
    value,
    onChange,
    decimals,
    locale,
    id,
    'aria-label': ariaLabel,
    className,
    disabled,
    placeholder
}: MoneyInputProps) {
    const [raw, setRaw] = useState(() => formatMoneyInput(value, decimals, locale))
    const focused = useRef(false)

    useEffect(() => {
        if (focused.current) return
        setRaw(formatMoneyInput(value, decimals, locale))
    }, [value, decimals, locale])

    return (
        <Input
            id={id}
            aria-label={ariaLabel}
            type="text"
            inputMode={decimals === 0 ? 'numeric' : 'decimal'}
            className={className}
            disabled={disabled}
            placeholder={placeholder}
            value={raw}
            onFocus={() => {
                focused.current = true
            }}
            onChange={event => {
                const next = event.target.value
                setRaw(next)
                onChange(parseMoneyInput(next, decimals))
            }}
            onBlur={() => {
                focused.current = false
                setRaw(formatMoneyInput(value, decimals, locale))
            }}
        />
    )
}
