-- =====================================================
-- FIX RLS POLICIES FOR ALL TABLES
-- Run this to allow CRUD operations for authenticated users
-- =====================================================

-- DROP existing restrictive policies
DROP POLICY IF EXISTS "Authenticated users can view categories" ON public.categories;
DROP POLICY IF EXISTS "Admins and Managers can manage products" ON public.products;

-- CATEGORIES - Allow all authenticated users to manage
CREATE POLICY "Categories - SELECT for authenticated" ON public.categories
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Categories - INSERT for authenticated" ON public.categories
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Categories - UPDATE for authenticated" ON public.categories
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Categories - DELETE for authenticated" ON public.categories
  FOR DELETE USING (auth.role() = 'authenticated');

-- PRODUCTS - Allow all authenticated users to manage
CREATE POLICY "Products - SELECT for authenticated" ON public.products
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Products - INSERT for authenticated" ON public.products
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Products - UPDATE for authenticated" ON public.products
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Products - DELETE for authenticated" ON public.products
  FOR DELETE USING (auth.role() = 'authenticated');

-- PRODUCT VARIANTS
CREATE POLICY "Product Variants - ALL for authenticated" ON public.product_variants
  FOR ALL USING (auth.role() = 'authenticated');

-- INVENTORY
CREATE POLICY "Inventory - ALL for authenticated" ON public.inventory
  FOR ALL USING (auth.role() = 'authenticated');

-- INVENTORY TRANSACTIONS
CREATE POLICY "Inventory Transactions - ALL for authenticated" ON public.inventory_transactions
  FOR ALL USING (auth.role() = 'authenticated');

-- SUPPLIERS
CREATE POLICY "Suppliers - ALL for authenticated" ON public.suppliers
  FOR ALL USING (auth.role() = 'authenticated');

-- PURCHASE ORDERS
CREATE POLICY "Purchase Orders - ALL for authenticated" ON public.purchase_orders
  FOR ALL USING (auth.role() = 'authenticated');

-- PURCHASE ORDER ITEMS
CREATE POLICY "Purchase Order Items - ALL for authenticated" ON public.purchase_order_items
  FOR ALL USING (auth.role() = 'authenticated');

-- CUSTOMERS
CREATE POLICY "Customers - ALL for authenticated" ON public.customers
  FOR ALL USING (auth.role() = 'authenticated');

-- ORDERS
CREATE POLICY "Orders - ALL for authenticated" ON public.orders
  FOR ALL USING (auth.role() = 'authenticated');

-- ORDER ITEMS
CREATE POLICY "Order Items - ALL for authenticated" ON public.order_items
  FOR ALL USING (auth.role() = 'authenticated');

-- PAYMENTS
CREATE POLICY "Payments - ALL for authenticated" ON public.payments
  FOR ALL USING (auth.role() = 'authenticated');

-- EXPENSES
CREATE POLICY "Expenses - ALL for authenticated" ON public.expenses
  FOR ALL USING (auth.role() = 'authenticated');

-- SETTINGS
CREATE POLICY "Settings - ALL for authenticated" ON public.settings
  FOR ALL USING (auth.role() = 'authenticated');
