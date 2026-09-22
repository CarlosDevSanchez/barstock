-- Seed Data for POS + Inventory Management System
-- Run this after schema.sql

-- Insert default settings
INSERT INTO public.settings (key, value) VALUES
  ('store_name', '"POS Inventory System"'),
  ('store_address', '"Calle 10 # 5-51, Bogotá, Colombia"'),
  ('store_phone', '"+57 300 000 0000"'),
  ('store_email', '"info@posystem.com"'),
  ('tax_rate', '0.19'), -- IVA general de Colombia. Supuesto D3, sin validar con contabilidad.
  ('currency', '"COP"'),
  ('timezone', '"America/Bogota"'),
  ('low_stock_threshold', '10'),
  ('receipt_template', '{"header": "¡Gracias por su compra!", "footer": "¡Vuelva pronto!"}');

-- Insert sample categories
INSERT INTO public.categories (id, name, description) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Electronics', 'Electronic devices and accessories'),
  ('22222222-2222-2222-2222-222222222222', 'Clothing', 'Apparel and fashion items'),
  ('33333333-3333-3333-3333-333333333333', 'Food & Beverages', 'Food and drink products'),
  ('44444444-4444-4444-4444-444444444444', 'Home & Garden', 'Home improvement and garden supplies'),
  ('55555555-5555-5555-5555-555555555555', 'Sports & Outdoors', 'Sports equipment and outdoor gear');

-- Insert sample products
INSERT INTO public.products (id, name, description, sku, barcode, category_id, cost_price, selling_price, tax_rate) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Wireless Mouse', 'Ergonomic wireless mouse with USB receiver', 'ELEC-001', '1234567890001', '11111111-1111-1111-1111-111111111111', 45000, 89900, 0.19),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'USB-C Cable', 'High-speed USB-C charging cable 6ft', 'ELEC-002', '1234567890002', '11111111-1111-1111-1111-111111111111', 15000, 29900, 0.19),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'T-Shirt', 'Cotton t-shirt available in multiple colors', 'CLTH-001', '1234567890003', '22222222-2222-2222-2222-222222222222', 25000, 59900, 0.19),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Coffee Beans', 'Premium Arabica coffee beans 1lb', 'FOOD-001', '1234567890004', '33333333-3333-3333-3333-333333333333', 20000, 35000, 0.05),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Water Bottle', 'Stainless steel water bottle 32oz', 'HOME-001', '1234567890005', '44444444-4444-4444-4444-444444444444', 40000, 79900, 0.19),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'Yoga Mat', 'Non-slip yoga mat with carrying strap', 'SPRT-001', '1234567890006', '55555555-5555-5555-5555-555555555555', 60000, 119900, 0.19);

-- Insert product variants for T-Shirt
INSERT INTO public.product_variants (product_id, name, variant_type, sku, barcode, cost_price, selling_price) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Small', 'size', 'CLTH-001-S', '1234567890103', 25000, 59900),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Medium', 'size', 'CLTH-001-M', '1234567890104', 25000, 59900),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Large', 'size', 'CLTH-001-L', '1234567890105', 25000, 59900),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Red', 'color', 'CLTH-001-RED', '1234567890106', 25000, 59900),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Blue', 'color', 'CLTH-001-BLU', '1234567890107', 25000, 59900),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Black', 'color', 'CLTH-001-BLK', '1234567890108', 25000, 59900);

-- Inventory rows are created by a trigger when a product is inserted (quantity 0); set the initial stock.
UPDATE public.inventory AS i
SET quantity = v.quantity, low_stock_threshold = v.threshold
FROM (VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 50, 10),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 100, 20),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 60, 10),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, 30, 10),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, 25, 5),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, 15, 5)
) AS v(product_id, quantity, threshold)
WHERE i.product_id = v.product_id AND i.variant_id IS NULL;

-- Insert sample suppliers
INSERT INTO public.suppliers (id, name, contact_person, email, phone, address) VALUES
  ('99999999-9999-9999-9999-999999999991', 'Tech Supplies Inc', 'John Doe', 'john@techsupplies.com', '+1234567890', '456 Tech Ave, Silicon Valley'),
  ('99999999-9999-9999-9999-999999999992', 'Fashion Wholesale', 'Jane Smith', 'jane@fashionwholesale.com', '+1234567891', '789 Fashion Blvd, New York'),
  ('99999999-9999-9999-9999-999999999993', 'Food Distributors', 'Bob Wilson', 'bob@fooddist.com', '+1234567892', '321 Food St, Chicago');

-- Insert sample customers
-- total_spent and loyalty_points are derived from completed orders (trigger), so they are not seeded.
INSERT INTO public.customers (id, name, email, phone) VALUES
  ('88888888-8888-8888-8888-888888888881', 'Alice Johnson', 'alice@example.com', '+1111111111'),
  ('88888888-8888-8888-8888-888888888882', 'Bob Williams', 'bob@example.com', '+2222222222'),
  ('88888888-8888-8888-8888-888888888883', 'Carol Davis', 'carol@example.com', '+3333333333');

-- Note: Orders and purchase orders will be created through the application
-- This seed data provides the foundation for testing
