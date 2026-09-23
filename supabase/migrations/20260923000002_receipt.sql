-- 0010 receipt: order_items.tax_rate captures the tax rate applied at sale time, purely as an informational
-- snapshot for the printed 80mm ticket (Phase 5 of the UI plan). This does NOT touch create_sale's money math:
-- tax and total are still computed and written by create_sale exactly as before; the trigger below only fills
-- one extra, read-only column from the product's *current* tax_rate.
--
-- Also: two new `settings` keys used by the ticket header (store_tax_id = NIT, store_logo_key = storage key for
-- the logo, uploaded in a later phase — the column exists now so that phase is additive).
--
-- Decision recorded in docs/06-roadmap/decisiones-pendientes.md (D21): the ticket is NOT a fiscal/electronic
-- invoice (no CUFE, no QR, no DIAN resolution number, no cash-received/change).

-- ---------------------------------------------------------------------------
-- order_items.tax_rate: fraction (0.19 = 19 %), same shape as products.tax_rate/settings.tax_rate.
-- ---------------------------------------------------------------------------
alter table public.order_items
  add column tax_rate numeric(6, 4);

-- ---------------------------------------------------------------------------
-- Trigger: before insert, if the caller (create_sale) did not supply a tax_rate, copy it from the product's
-- current rate. create_sale's own insert list is unchanged (order_id, product_id, variant_id, quantity,
-- unit_price, discount, tax, total) so this always fires and fills the column; it never overrides a value the
-- caller did provide.
-- ---------------------------------------------------------------------------
create or replace function public.order_items_set_tax_rate()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.tax_rate is null and new.product_id is not null then
    select p.tax_rate into new.tax_rate
    from public.products p
    where p.id = new.product_id;
  end if;
  return new;
end;
$$;
revoke all on function public.order_items_set_tax_rate() from public, anon, authenticated;

drop trigger if exists order_items_set_tax_rate on public.order_items;
create trigger order_items_set_tax_rate
  before insert on public.order_items
  for each row execute function public.order_items_set_tax_rate();

-- ---------------------------------------------------------------------------
-- Backfill: rows written before this column existed have no snapshot of the rate that was actually charged (the
-- product's rate may have changed since). Reconstruct it from what was actually billed: tax / taxable base,
-- rounded to 4 decimals. A fully-discounted line (base = 0) has no meaningful rate: nullif(...,0) leaves it NULL.
-- ---------------------------------------------------------------------------
update public.order_items
   set tax_rate = round(tax / nullif(unit_price * quantity - discount, 0), 4)
 where tax_rate is null;

-- ---------------------------------------------------------------------------
-- settings: NIT and the (not-yet-uploaded) logo storage key. Both are plain JSONB rows like every other setting;
-- no default row is inserted here (lib/server/services/settings.ts falls back to '' when a key is missing).
-- ---------------------------------------------------------------------------
-- (no schema change needed: `settings` stores arbitrary keys as JSONB rows)
