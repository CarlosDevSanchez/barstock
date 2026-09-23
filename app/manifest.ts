import type { MetadataRoute } from 'next'

// Provisional icons (generated from the brand color, public/icons/*): replace with the real logo when there is one.
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
