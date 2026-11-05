-- Moves each risk to the ten domains of family wealth (the hub's risk
-- categories, from 20261124000000_risk_categories_ten_domains.sql in the
-- hub). Run after the hub script. Suggestions already dismissed or accepted
-- keep their answers.

update public.risks set category = case category
    when 'relationships' then 'dynamics'
    when 'rising_generation' then 'learning'
    when 'succession' then case when subcategory in ('Wills and estate planning', 'Incapacity planning') then 'estate_legal' else 'leadership' end
    when 'legal' then 'estate_legal'
    when 'tax' then 'financial'
    when 'investments' then 'investment'
    when 'protection' then 'risk'
    when 'administration' then 'financial'
    else category
  end,
  subcategory = case
    when category = 'relationships' then subcategory
    when category = 'rising_generation' and subcategory = 'Next-generation leadership' then 'Preparing successors'
    when category = 'rising_generation' and subcategory = 'Wellbeing' then null
    when category = 'tax' then 'Tax'
    when category = 'administration' and subcategory = 'Key staff' then null
    else subcategory
  end
where category in ('relationships', 'rising_generation', 'succession', 'legal', 'tax', 'investments', 'protection', 'administration');
