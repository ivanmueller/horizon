-- hotels: address, phone, primary contact, website
--
-- Five new nullable text columns to power the hotel detail
-- drawer's Details sidebar. None are referenced by attribution
-- or commission calc — these are pure admin metadata (concierge
-- desk contact info, mailing address for invoices, etc.).
--
-- address is left as a single multi-line TEXT rather than split
-- into line1/line2/city/postal — onboarding admins paste from
-- Google Maps, and at this scale we don't need structured search.
-- The first migration that needs that can split it.
--
-- primary_contact is two columns (name + email) so they can be
-- edited independently and either can be empty without the other.

alter table public.hotels
  add column if not exists address               text,
  add column if not exists phone                 text,
  add column if not exists primary_contact_name  text,
  add column if not exists primary_contact_email text,
  add column if not exists website               text;
