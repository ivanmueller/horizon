-- Simplify the Placements model.
--
-- `tag` was display-only and, after the Placements table dropped its
-- Tag column, is shown nowhere — the human label is `name` and the
-- canonical attribution key is the minted `code`. An invisible
-- auto-derived value is dead weight, so it's removed entirely.
--
-- `quantity_printed` had no consumer (no report, no cost rollup) and
-- is meaningless for digital placements (website widget, lobby QR);
-- removed to keep creation to "Type + Name and you're done".

alter table placements drop column if exists tag;
alter table placements drop column if exists quantity_printed;
