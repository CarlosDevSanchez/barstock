-- Seed Data for POS + Inventory Management System
-- Run this after schema.sql

-- Insert default settings
INSERT INTO public.settings (key, value) VALUES
  ('store_name', '"POS Inventory System"'),
  ('store_address', '"123 Main Street, City, Country"'),
  ('store_phone', '"+1234567890"'),
  ('store_email', '"info@posystem.com"'),
  ('tax_rate', '0.10'),
  ('currency', '"USD"'),
  ('low_stock_threshold', '10'),
  ('receipt_template', '{"header": "Thank you for your purchase!", "footer": "Visit us again!"}');

-- Insert sample categories
INSERT INTO public.categories (id, name, description) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Electronics', 'Electronic devices and accessories'),
  ('22222222-2222-2222-2222-222222222222', 'Clothing', 'Apparel and fashion items'),
  ('33333333-3333-3333-3333-333333333333', 'Food & Beverages', 'Food and drink products'),
  ('44444444-4444-4444-4444-444444444444', 'Home & Garden', 'Home improvement and garden supplies'),
  ('55555555-5555-5555-5555-555555555555', 'Sports & Outdoors', 'Sports equipment and outdoor gear');

-- Insert sample products
INSERT INTO public.products (id, name, description, sku, barcode, category_id, cost_price, selling_price, tax_rate) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Wireless Mouse', 'Ergonomic wireless mouse with USB receiver', 'ELEC-001', '1234567890001', '11111111-1111-1111-1111-111111111111', 15.00, 29.99, 0.10),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'USB-C Cable', 'High-speed USB-C charging cable 6ft', 'ELEC-002', '1234567890002', '11111111-1111-1111-1111-111111111111', 5.00, 12.99, 0.10),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'T-Shirt', 'Cotton t-shirt available in multiple colors', 'CLTH-001', '1234567890003', '22222222-2222-2222-2222-222222222222', 8.00, 19.99, 0.10),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Coffee Beans', 'Premium Arabica coffee beans 1lb', 'FOOD-001', '1234567890004', '33333333-3333-3333-3333-333333333333', 10.00, 24.99, 0.05),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Water Bottle', 'Stainless steel water bottle 32oz', 'HOME-001', '1234567890005', '44444444-4444-4444-4444-444444444444', 12.00, 29.99, 0.10),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'Yoga Mat', 'Non-slip yoga mat with carrying strap', 'SPRT-001', '1234567890006', '55555555-5555-5555-5555-555555555555', 15.00, 39.99, 0.10);

-- Insert product variants for T-Shirt
INSERT INTO public.product_variants (product_id, name, variant_type, sku, barcode, cost_price, selling_price) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Small', 'size', 'CLTH-001-S', '1234567890103', 8.00, 19.99),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Medium', 'size', 'CLTH-001-M', '1234567890104', 8.00, 19.99),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Large', 'size', 'CLTH-001-L', '1234567890105', 8.00, 19.99),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Red', 'color', 'CLTH-001-RED', '1234567890106', 8.00, 19.99),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Blue', 'color', 'CLTH-001-BLU', '1234567890107', 8.00, 19.99),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Black', 'color', 'CLTH-001-BLK', '1234567890108', 8.00, 19.99);

-- Insert inventory records
INSERT INTO public.inventory (product_id, variant_id, quantity, low_stock_threshold) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, 50, 10),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', NULL, 100, 20),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', NULL, 30, 10),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', NULL, 25, 5),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', NULL, 15, 5);

-- Insert sample suppliers
INSERT INTO public.suppliers (id, name, contact_person, email, phone, address) VALUES
  ('99999999-9999-9999-9999-999999999991', 'Tech Supplies Inc', 'John Doe', 'john@techsupplies.com', '+1234567890', '456 Tech Ave, Silicon Valley'),
  ('99999999-9999-9999-9999-999999999992', 'Fashion Wholesale', 'Jane Smith', 'jane@fashionwholesale.com', '+1234567891', '789 Fashion Blvd, New York'),
  ('99999999-9999-9999-9999-999999999993', 'Food Distributors', 'Bob Wilson', 'bob@fooddist.com', '+1234567892', '321 Food St, Chicago');

-- Insert sample customers
INSERT INTO public.customers (id, name, email, phone, loyalty_points, total_spent) VALUES
  ('88888888-8888-8888-8888-888888888881', 'Alice Johnson', 'alice@example.com', '+1111111111', 150, 450.00),
  ('88888888-8888-8888-8888-888888888882', 'Bob Williams', 'bob@example.com', '+2222222222', 200, 600.00),
  ('88888888-8888-8888-8888-888888888883', 'Carol Davis', 'carol@example.com', '+3333333333', 75, 225.00);

-- Note: Orders and purchase orders will be created through the application
-- This seed data provides the foundation for testing
