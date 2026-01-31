"use client"

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Settings as SettingsIcon, Save } from 'lucide-react'

export default function SettingsPage() {
    const [settings, setSettings] = useState({
        storeName: 'POS Inventory System',
        storeAddress: '123 Main Street, City, Country',
        storePhone: '+1234567890',
        storeEmail: 'info@posystem.com',
        taxRate: '10',
        currency: 'USD',
        lowStockThreshold: '10',
    })

    const handleSave = () => {
        toast.success('Settings saved successfully!')
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold">Settings</h1>
                <p className="text-muted-foreground">Configure your store settings and preferences</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <Card className="rounded-2xl">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <SettingsIcon className="h-5 w-5 text-emerald-600" />
                            Store Information
                        </CardTitle>
                        <CardDescription>Basic store details and contact information</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label className="text-foreground font-semibold">Store Name</Label>
                            <Input
                                value={settings.storeName}
                                onChange={(e) => setSettings({ ...settings, storeName: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-foreground font-semibold">Address</Label>
                            <Input
                                value={settings.storeAddress}
                                onChange={(e) => setSettings({ ...settings, storeAddress: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-foreground font-semibold">Phone</Label>
                            <Input
                                value={settings.storePhone}
                                onChange={(e) => setSettings({ ...settings, storePhone: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-foreground font-semibold">Email</Label>
                            <Input
                                type="email"
                                value={settings.storeEmail}
                                onChange={(e) => setSettings({ ...settings, storeEmail: e.target.value })}
                            />
                        </div>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl">
                    <CardHeader>
                        <CardTitle>Business Settings</CardTitle>
                        <CardDescription>Currency, tax, and operational settings</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label className="text-foreground font-semibold">Currency</Label>
                            <Select value={settings.currency} onValueChange={(value) => setSettings({ ...settings, currency: value })}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="USD">USD - US Dollar</SelectItem>
                                    <SelectItem value="EUR">EUR - Euro</SelectItem>
                                    <SelectItem value="GBP">GBP - British Pound</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-foreground font-semibold">Tax Rate (%)</Label>
                            <Input
                                type="number"
                                value={settings.taxRate}
                                onChange={(e) => setSettings({ ...settings, taxRate: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-foreground font-semibold">Low Stock Threshold</Label>
                            <Input
                                type="number"
                                value={settings.lowStockThreshold}
                                onChange={(e) => setSettings({ ...settings, lowStockThreshold: e.target.value })}
                            />
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="flex justify-end">
                <Button onClick={handleSave} size="lg">
                    <Save className="mr-2 h-4 w-4" />
                    Save Settings
                </Button>
            </div>
        </div>
    )
}
