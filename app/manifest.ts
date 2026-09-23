import type { MetadataRoute } from 'next'

// Icons generated from the Barstock brand mark (public/branding/barstock-icon.svg → public/icons/*).
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'Barstock POS',
        short_name: 'Barstock',
        description: 'Point of sale and inventory management',
        start_url: '/pos',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#059669',
        icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
    }
}
