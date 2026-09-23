'use client'

import type { ComponentProps } from 'react'
import { FormControl, FormDescription, FormField, FormItem, FormLabel } from '@/components/ui/form'
import { TranslatedFormMessage } from '@/components/translated-form-message'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// Field wrappers meant to be used inside <Form {...form}> (they take the react-hook-form context, so no `control` prop).

type InputProps = Omit<ComponentProps<typeof Input>, 'name' | 'value' | 'onChange' | 'onBlur' | 'ref'>

interface TextFieldProps extends InputProps {
    name: string
    label: string
    description?: string
    className?: string
}

export function TextField({ name, label, description, className, ...inputProps }: TextFieldProps) {
    return (
        <FormField
            name={name}
            render={({ field }) => (
                <FormItem className={className}>
                    <FormLabel>{label}</FormLabel>
                    <FormControl>
                        <Input {...inputProps} {...field} value={field.value ?? ''} />
                    </FormControl>
                    {description && <FormDescription>{description}</FormDescription>}
                    <TranslatedFormMessage />
                </FormItem>
            )}
        />
    )
}

interface SwitchFieldProps {
    name: string
    label: string
    description?: string
    className?: string
}

/** A boolean toggle (e.g. `is_active`) wired to react-hook-form, without pulling in a new Radix dependency. */
export function SwitchField({ name, label, description, className }: SwitchFieldProps) {
    return (
        <FormField
            name={name}
            render={({ field }) => (
                <FormItem
                    className={`flex flex-row items-center justify-between rounded-lg border p-3 ${className ?? ''}`}
                >
                    <div className="space-y-0.5">
                        <FormLabel className="cursor-pointer">{label}</FormLabel>
                        {description && <FormDescription>{description}</FormDescription>}
                    </div>
                    <FormControl>
                        <input
                            type="checkbox"
                            role="switch"
                            aria-checked={field.value ?? true}
                            checked={field.value ?? true}
                            onChange={e => field.onChange(e.target.checked)}
                            className="h-4 w-4 cursor-pointer accent-emerald-600"
                        />
                    </FormControl>
                </FormItem>
            )}
        />
    )
}

interface SelectFieldProps {
    name: string
    label: string
    placeholder: string
    options: ReadonlyArray<{ value: string; label: string }>
    /** Adds a first option that clears the field (stored as ''), for optional relations such as a category. */
    noneLabel?: string
    className?: string
    disabled?: boolean
}

const NONE = '__none__'

export function SelectField({ name, label, placeholder, options, noneLabel, className, disabled }: SelectFieldProps) {
    return (
        <FormField
            name={name}
            render={({ field }) => (
                <FormItem className={className}>
                    <FormLabel>{label}</FormLabel>
                    <Select
                        value={field.value ? String(field.value) : undefined}
                        onValueChange={value => field.onChange(value === NONE ? '' : value)}
                        disabled={disabled}
                    >
                        <FormControl>
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder={placeholder} />
                            </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                            {noneLabel && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
                            {options.map(option => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <TranslatedFormMessage />
                </FormItem>
            )}
        />
    )
}
