-- Phase 6 (UI plan): product images move to Cloudflare R2 (private bucket, signed URLs). `products.image_url` is
-- the old, unused column (a raw URL a client could point anywhere); it is left in place (never dropped, never
-- written again) so any historical value is still readable. `image_key` is the new, server-generated R2 object key
-- (lib/server/storage.ts: putObject/deleteObject/signedGetUrl). The client never supplies this value directly: it
-- always comes from the upload endpoint (app/api/v1/products/[id]/image/route.ts), which is why the CHECK below is
-- strict about the shape instead of just "not empty".
--
-- Key shape: products/{productId}/{uuid}.{webp|jpg|png} — both path segments are UUIDs (36 chars, lowercase hex +
-- dashes), matching lib/server/storage.ts's `productImageKey`.
alter table public.products
  add column image_key text
  constraint products_image_key_format
    check (image_key ~ '^products/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg|png)$');
