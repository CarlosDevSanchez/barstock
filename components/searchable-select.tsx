'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface SearchableSelectOption {
    value: string
    label: string
    sublabel?: string
}

interface SearchableSelectProps {
    value: string
    onValueChange: (value: string) => void
    options: SearchableSelectOption[]
    /** Controlled search text — the caller owns it (usually debounced against an API `q` param). */
    search: string
    onSearchChange: (value: string) => void
    placeholder: string
    searchPlaceholder?: string
    emptyLabel?: string
    id?: string
    disabled?: boolean
    className?: string
}

/**
 * Single-select dropdown with the search box built into the popup itself, instead of a separate
 * search field sitting above a plain `<select>` (the pattern this replaces: a proveedor/producto
 * picker backed by a searched API list). `options` is whatever the caller already fetched for
 * `search`; this component only renders and lets the user filter further by typing.
 */
export function SearchableSelect({
    value,
    onValueChange,
    options,
    search,
    onSearchChange,
    placeholder,
    searchPlaceholder,
    emptyLabel,
    id,
    disabled,
    className
}: SearchableSelectProps) {
    const tc = useTranslations('common')
    const [open, setOpen] = useState(false)
    const [activeIndex, setActiveIndex] = useState(0)
    const inputRef = useRef<HTMLInputElement>(null)
    // A Dialog locks page scroll to its own DOM subtree; a Popover normally portals to `document.body`,
    // landing outside that subtree, so wheel/touch scroll inside it gets swallowed. Portaling into the
    // enclosing DialogContent instead (found via this ref on the trigger) keeps the popup a real
    // descendant, so its internal list scrolls normally. Set from a ref callback, not an effect, so
    // it's ready by first paint.
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
    const dialogContainer = (anchor?.closest('[data-slot="dialog-content"]') as HTMLElement | null) ?? undefined
    const selected = options.find(option => option.value === value)

    useEffect(() => {
        if (!open) return
        // Popover moves focus to the content on open; grab it back for the search box on the next tick.
        requestAnimationFrame(() => inputRef.current?.focus())
    }, [open])

    const handleOpenChange = (next: boolean) => {
        setOpen(next)
        if (next) setActiveIndex(0)
    }

    const choose = (option: SearchableSelectOption) => {
        onValueChange(option.value)
        setOpen(false)
    }

    return (
        <Popover open={open} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
                <Button
                    ref={setAnchor}
                    id={id}
                    type="button"
                    variant="outline"
                    disabled={disabled}
                    className={cn(
                        'w-full justify-between font-normal',
                        !selected && 'text-muted-foreground',
                        className
                    )}
                >
                    <span className="truncate">{selected ? selected.label : placeholder}</span>
                    <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                container={dialogContainer}
                className="w-(--radix-popover-trigger-width) min-w-64"
            >
                <div className="p-2">
                    <Input
                        ref={inputRef}
                        value={search}
                        onChange={event => onSearchChange(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === 'ArrowDown') {
                                event.preventDefault()
                                setActiveIndex(index => Math.min(index + 1, options.length - 1))
                            } else if (event.key === 'ArrowUp') {
                                event.preventDefault()
                                setActiveIndex(index => Math.max(index - 1, 0))
                            } else if (event.key === 'Enter') {
                                event.preventDefault()
                                const option = options[activeIndex]
                                if (option) choose(option)
                            } else if (event.key === 'Escape') {
                                setOpen(false)
                            }
                        }}
                        placeholder={searchPlaceholder ?? tc('search')}
                    />
                </div>
                <div className="max-h-64 overflow-y-auto p-1">
                    {options.length === 0 ? (
                        <p className="px-2 py-1.5 text-sm text-muted-foreground">{emptyLabel ?? tc('noResults')}</p>
                    ) : (
                        options.map((option, index) => (
                            <button
                                key={option.value}
                                type="button"
                                onMouseEnter={() => setActiveIndex(index)}
                                onClick={() => choose(option)}
                                className={cn(
                                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                                    index === activeIndex ? 'bg-accent text-accent-foreground' : ''
                                )}
                            >
                                <Check
                                    className={cn(
                                        'size-4 shrink-0',
                                        option.value === value ? 'opacity-100' : 'opacity-0'
                                    )}
                                />
                                <span className="flex min-w-0 flex-col">
                                    <span className="truncate">{option.label}</span>
                                    {option.sublabel ? (
                                        <span className="truncate text-xs text-muted-foreground">
                                            {option.sublabel}
                                        </span>
                                    ) : null}
                                </span>
                            </button>
                        ))
                    )}
                </div>
            </PopoverContent>
        </Popover>
    )
}
