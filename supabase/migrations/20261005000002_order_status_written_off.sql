-- New order_status value must be committed before any migration uses it (Postgres rule).
alter type public.order_status add value if not exists 'written_off';
