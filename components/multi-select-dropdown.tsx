'use client'

import { useState } from 'react'
import { ChevronsUpDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface MultiSelectOption {
    value: string
    label: string
}

interface MultiSelectDropdownProps {
    values: string[]
    onChange: (values: string[]) => void
    options: MultiSelectOption[]
    placeholder: string
    id?: string
    className?: string
}

/**
 * Compact multi-select: a dropdown with checkboxes instead of a row of loose checkboxes taking up
 * the whole width of the form (the pattern this replaces, e.g. jornada's "responsables").
 */
export function MultiSelectDropdown({
    values,
    onChange,
    options,
    placeholder,
    id,
    className
}: MultiSelectDropdownProps) {
    const tc = useTranslations('common')
    // See SearchableSelect for why this portals into the enclosing Dialog when there is one.
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
    const dialogContainer = (anchor?.closest('[data-slot="dialog-content"]') as HTMLElement | null) ?? undefined
    const selected = options.filter(option => values.includes(option.value))

    const toggle = (value: string) => {
        onChange(values.includes(value) ? values.filter(item => item !== value) : [...values, value])
    }

    const label =
        selected.length === 0
            ? placeholder
            : selected.length === 1
              ? (selected[0]?.label ?? placeholder)
              : tc('selectedCount', { count: selected.length })

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    ref={setAnchor}
                    id={id}
                    type="button"
                    variant="outline"
                    className={cn(
                        'w-full justify-between font-normal',
                        selected.length === 0 && 'text-muted-foreground',
                        className
                    )}
                >
                    <span className="truncate">{label}</span>
                    <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                container={dialogContainer}
                className="w-(--radix-popover-trigger-width) min-w-56 p-1"
            >
                <div className="max-h-64 overflow-y-auto">
                    {options.map(option => {
                        const checked = values.includes(option.value)
                        return (
                            <label
                                key={option.value}
                                className="hover:bg-accent flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm"
                            >
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggle(option.value)}
                                    className="size-4"
                                />
                                {option.label}
                            </label>
                        )
                    })}
                </div>
            </PopoverContent>
        </Popover>
    )
}
