# POS + Inventory Management SaaS

A modern, full-stack Point of Sale and Inventory Management System built with Next.js 14, Supabase, and TypeScript.

## 🚀 Features

### Authentication
- ✅ Login / Register / Forgot Password
- ✅ Role-based access control (Admin, Manager, Cashier)
- ✅ Protected routes with middleware

### Dashboard
- ✅ Real-time revenue statistics
- ✅ Sales charts (last 7 days)
- ✅ Top selling products
- ✅ Low stock alerts

### POS System
- ✅ Product search and filtering
- ✅ Shopping cart with Zustand state management
- ✅ Customer selection
- ✅ Discount and tax calculation
- ✅ Multiple payment methods (Cash, Card, E-Wallet)
- ✅ Order completion with inventory updates
- ✅ Receipt printing support

### Product Management
- ✅ Full CRUD operations
- ✅ Category management
- ✅ SKU and barcode support
- ✅ Product variants (size, color)
- ✅ Cost and selling price tracking
- ✅ Active/inactive status

### Inventory
- ✅ Real-time stock level monitoring
- ✅ Low stock alerts
- ✅ Inventory value calculation
- ✅ Transaction history logging
- ✅ Automatic stock updates on sales

### Orders
- ✅ Complete order history
- ✅ Order status tracking
- ✅ Customer information
- ✅ Invoice generation (ready)

### Customers
- ✅ Customer database
- ✅ Loyalty points tracking
- ✅ Total spent tracking
- ✅ Purchase history (ready)

### Suppliers
- ✅ Supplier management
- ✅ Contact information
- ✅ Purchase order system (ready)

### Reports
- ✅ Sales analytics
- ✅ Revenue charts
- ✅ Best sellers report
- ✅ Profit analysis (ready)

### Settings
- ✅ Store information
- ✅ Tax rate configuration
- ✅ Currency selection
- ✅ Low stock threshold

## 🛠️ Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Database:** Supabase (PostgreSQL)
- **Authentication:** Supabase Auth
- **UI:** TailwindCSS + shadcn/ui
- **Icons:** Lucide React
- **Charts:** Recharts
- **State Management:** Zustand
- **Forms:** React Hook Form + Zod (ready)
- **Notifications:** Sonner
- **Date Handling:** date-fns

## 📦 Installation

### Prerequisites
- Node.js 18+ installed
- A Supabase account and project

### 1. Clone the repository

```bash
cd "c:\Pos System"
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Run the SQL schema:
   - Go to your Supabase project → SQL Editor
   - Copy and paste the contents of `supabase/schema.sql`
   - Execute the SQL
3. (Optional) Load seed data:
   - Copy and paste the contents of `supabase/seed.sql`
   - Execute the SQL

### 4. Configure environment variables

Copy `.env.local.example` to `.env.local`:

```bash
cp .env.local.example .env.local
```

Update `.env.local` with your Supabase credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

You can find these in your Supabase project settings → API.

### 5. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## 🎨 Design System

- **Primary Color:** Emerald (#10B981)
- **Secondary Color:** Slate Gray
- **Border Radius:** rounded-2xl (1rem)
- **Card Style:** Soft shadows with glassmorphism
- **Typography:** Geist Sans & Geist Mono
- **Dark Mode:** Full support with theme toggle

## 📁 Project Structure

```
c:\Pos System/
├── app/
│   ├── (auth)/              # Authentication pages
│   │   ├── login/
│   │   ├── register/
│   │   └── forgot-password/
│   ├── (dashboard)/         # Protected dashboard routes
│   │   ├── dashboard/       # Main dashboard
│   │   ├── pos/             # Point of Sale
│   │   ├── products/        # Product management
│   │   ├── inventory/       # Inventory tracking
│   │   ├── orders/          # Order history
│   │   ├── customers/       # Customer database
│   │   ├── suppliers/       # Supplier management
│   │   ├── reports/         # Analytics & reports
│   │   ├── settings/        # System settings
│   │   └── layout.tsx       # Dashboard layout
│   ├── layout.tsx           # Root layout
│   └── page.tsx             # Home page (redirects)
├── components/
│   ├── ui/                  # shadcn/ui components
│   ├── layout/              # Layout components
│   └── theme-provider.tsx   # Dark mode provider
├── lib/
│   ├── supabase/
│   │   └── client.ts        # Supabase client
│   ├── utils.ts             # Utility functions
│   └── constants.ts         # App constants
├── stores/
│   ├── cart.ts              # POS cart store
│   ├── auth.ts              # Auth store
│   └── settings.ts          # Settings store
├── types/
│   └── index.ts             # TypeScript types
├── supabase/
│   ├── schema.sql           # Database schema
│   └── seed.sql             # Seed data
└── package.json
```

## 🔐 Default User Accounts

After running the seed SQL, you can create test accounts:

1. Go to `/register`
2. Create an account with any email
3. Select role: Admin, Manager, or Cashier

**Note:** Email verification is required. Check your Supabase Auth settings to disable it for testing or use the Supabase dashboard to verify users manually.

## 🎯 Usage Guide

### 1. Creating Products

1. Navigate to **Products** page
2. Click "Add Product"
3. Fill in product details (name, SKU, prices, category)
4. Set cost price and selling price
5. Save

### 2. Managing Inventory

1. Products automatically get inventory records
2. View stock levels in **Inventory** page
3. Low stock items are highlighted
4. Set custom low stock thresholds

### 3. Making Sales (POS)

1. Go to **POS** page
2. Search or browse products
3. Click products to add to cart
4. Adjust quantities using +/- buttons
5. (Optional) Select customer
6. Set discount if needed
7. Click "Checkout"
8. Select payment method
9. Complete order

### 4. Viewing Reports

1. Navigate to **Dashboard** for overview
2. Check **Reports** for detailed analytics
3. Monitor sales trends and top products

## 🚀 Deployment

### Deploy to Vercel

```bash
npm run build
vercel --prod
```

Make sure to add environment variables in Vercel dashboard.

## 📝 Database Schema

The system uses 14+ tables:

- `profiles` - User profiles and roles
- `categories` - Product categories
- `products` - Product catalog
- `product_variants` - Size/color variants
- `inventory` - Stock levels
- `inventory_transactions` - Stock movement logs
- `suppliers` - Supplier directory
- `purchase_orders` - Stock purchasing
- `purchase_order_items` - PO line items
- `customers` - Customer database
- `orders` - Sales transactions
- `order_items` - Order line items
- `payments` - Payment records
- `expenses` - Expense tracking
- `settings` - System configuration

## 🛡️ Security

- Row Level Security (RLS) enabled on all tables
- Role-based access control
- Protected routes with authentication middleware
- Secure password hashing via Supabase Auth

## 🔄 Realtime Features (Ready for implementation)

The foundation supports realtime updates:

- Inventory level changes
- New orders
- Low stock alerts

## ⌨️ Keyboard Shortcuts (Ready for implementation)

- `Ctrl/Cmd + K` - Search products
- `Ctrl/Cmd + N` - New order
- `Ctrl/Cmd + P` - Print receipt

## 📱 Responsive Design

- ✅ Mobile (375px+)
- ✅ Tablet (768px+)
- ✅ Desktop (1280px+)
- ✅ Mobile POS optimized layout

## 🤝 Contributing

This is a fully-featured production-ready POS system. You can extend it with:

- Print receipt templates
- Advanced reporting
- Multi-location support
- Barcode scanner integration
- Offline mode with service workers
- Email notifications
- Backup and restore

## 📄 License

MIT License - Feel free to use for commercial projects

## 🆘 Support

For issues or questions:
1. Check the Supabase logs
2. Verify environment variables
3. Ensure database schema is properly set up

## 🎉 Acknowledgments

- Built with [Next.js](https://nextjs.org/)
- Powered by [Supabase](https://supabase.com/)
- UI components from [shadcn/ui](https://ui.shadcn.com/)
- Icons by [Lucide](https://lucide.dev/)

---

**Happy Selling! 🛒**
