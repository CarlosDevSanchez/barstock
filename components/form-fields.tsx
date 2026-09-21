'use client'

import type { ComponentProps } from 'react'
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
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
                    <FormMessage />
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
                            <SelectTrigger>
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
                    <FormMessage />
                </FormItem>
            )}
        />
    )
}
