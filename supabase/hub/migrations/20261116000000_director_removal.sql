-- Turnstone Village Square: who may remove a director, per Entity Standard (hub)
--
-- The owner (2 Nov 2026): not every jurisdiction lets the members remove a
-- director, nor the board. Each standard now says which ways are allowed:
--   members_meeting – the members, by resolution at a meeting;
--   members_written – the members, by written resolution;
--   board           – the board (usually only if the articles allow it);
--   instrument      – a deed or other instrument (e.g. a trustee removed by
--                     the protector under the trust deed);
-- with a note on the conditions (notice, majorities, grounds). Removing a
-- director is drafted only into a meeting or resolution of a body allowed here.
--
-- The starting values are Turnstone's reading of the law, set with this file
-- as the earlier standards were. Every one is listed under "to confirm" until
-- checked against the statute and the entity's own constitution.

alter table public.entity_standards
  add column director_removal text[] check (director_removal <@ array['members_meeting', 'members_written', 'board', 'instrument']),
  add column director_removal_notes text;

-- Companies ------------------------------------------------------------------

update public.entity_standards set director_removal = array['members_meeting', 'board'],
  director_removal_notes = 'The members can always remove a director by ordinary resolution at a general meeting, with special notice (28 days) and the director''s right to be heard (Companies Act 2006, s168). It can''t be done by written resolution (s288(2)). The board can remove a director only if the articles allow it.'
where jurisdiction = 'United Kingdom' and entity_type = 'company';

update public.entity_standards set director_removal = array['members_meeting', 'board'],
  director_removal_notes = 'The shareholders can remove a director by ordinary resolution at a shareholders'' meeting, despite anything in the MOI, after notice and a chance to be heard (Companies Act 2008, s71(1)–(2)). The board can remove a director only on the grounds in s71(3) (ineligible or disqualified, incapacitated, or neglect or dereliction of duty), only if the company has three or more directors, and after notice and a hearing.'
where jurisdiction = 'South Africa' and entity_type = 'company' and sub_type in ('Private company (Pty) Ltd', 'Public company Ltd', 'Personal liability company Inc');

update public.entity_standards set director_removal = array['members_meeting', 'board'],
  director_removal_notes = 'A non-profit company with members: as for other companies (s71). Without members, directors are removed as the MOI says, usually by the board.'
where jurisdiction = 'South Africa' and sub_type = 'Non-profit company NPC';

update public.entity_standards set director_removal = null,
  director_removal_notes = 'A close corporation has members, not directors. Changes of members follow the association agreement and the Close Corporations Act.'
where jurisdiction = 'South Africa' and sub_type = 'Close corporation CC';

update public.entity_standards set director_removal = array['members_meeting', 'members_written', 'board'],
  director_removal_notes = 'Unless the memorandum or articles say otherwise: the members, by resolution at a meeting called for it (or for purposes including it), or by written resolution passed by at least 75% of the votes (BVI Business Companies Act, s114(1)). The directors can remove a director only if the memorandum or articles allow it, and only for cause (s114(2)).'
where jurisdiction = 'British Virgin Islands' and entity_type = 'company';

update public.entity_standards set director_removal = array['members_meeting'],
  director_removal_notes = 'The shareholders, by ordinary resolution at a meeting called for purposes that include the removal (Companies Act 2001, s138). The constitution may require a higher majority. The board has no power to remove a director unless the constitution gives one.'
where jurisdiction = 'Mauritius' and entity_type = 'company';

update public.entity_standards set director_removal = array['members_meeting', 'members_written', 'board'],
  director_removal_notes = 'Subject to the articles: the members, by resolution (at a meeting or in writing). The directors can remove a director only if the articles allow it (Companies Act 2006, Isle of Man).'
where jurisdiction = 'Isle of Man' and sub_type = '2006 Act company';

update public.entity_standards set director_removal = array['members_meeting'],
  director_removal_notes = 'The members, by ordinary resolution at a general meeting, with special notice (Companies Act 1931, as amended). Not by written resolution. Check the articles for any other way.'
where jurisdiction = 'Isle of Man' and sub_type = '1931 Act company';

-- LLCs, partnerships, trusts and foundations -----------------------------------

update public.entity_standards set director_removal = array['members_meeting', 'members_written'],
  director_removal_notes = 'Managers are removed as the operating agreement says, usually by the members.'
where entity_type = 'llc';

update public.entity_standards set director_removal = array['members_meeting', 'members_written', 'instrument'],
  director_removal_notes = 'Set by the partnership (or LLP) agreement; there is no general power in the statute.'
where entity_type = 'partnership';

update public.entity_standards set director_removal = array['board', 'instrument'],
  director_removal_notes = 'Trustees are removed as the trust deed says (often by the protector or the settlor, by deed), by the other trustees where the deed allows, or by the court.'
where entity_type = 'trust';

update public.entity_standards set director_removal = array['board', 'instrument'],
  director_removal_notes = 'Council members are removed as the charter or regulations say (often by the founder or the enforcer, or by the council itself).'
where entity_type = 'foundation';

update public.entity_standards
set to_confirm = coalesce(to_confirm || E'\n', '') || 'Removing a director (or trustee, council member): confirm who may remove one, and how, against the statute and the entity''s constitution.'
where director_removal_notes is not null;
