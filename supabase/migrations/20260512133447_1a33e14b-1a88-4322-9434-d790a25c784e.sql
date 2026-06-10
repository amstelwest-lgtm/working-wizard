CREATE TABLE public.industry_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_type text NOT NULL,
  metric_key text NOT NULL,
  p25 numeric NOT NULL,
  p50 numeric NOT NULL,
  p75 numeric NOT NULL,
  unit text NOT NULL DEFAULT 'pct',
  higher_is_better boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_type, metric_key)
);

ALTER TABLE public.industry_benchmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "benchmarks readable by authenticated"
  ON public.industry_benchmarks FOR SELECT
  TO authenticated
  USING (true);

-- Seed curated benchmarks. unit: pct | days | x | money
INSERT INTO public.industry_benchmarks (business_type, metric_key, p25, p50, p75, unit, higher_is_better) VALUES
-- RETAIL
('retail','grossMargin',25,38,50,'pct',true),
('retail','operatingMargin',2,5,9,'pct',true),
('retail','netMargin',1,3,6,'pct',true),
('retail','debtorDays',5,15,30,'days',false),
('retail','inventoryDays',30,60,90,'days',false),
('retail','creditorDays',20,40,60,'days',true),
('retail','assetTurnover',1.5,2.5,3.5,'x',true),
('retail','roa',3,7,12,'pct',true),
('retail','roe',8,15,25,'pct',true),
('retail','fixedCostRatio',15,25,35,'pct',false),
-- SERVICES
('services','grossMargin',40,55,70,'pct',true),
('services','operatingMargin',8,15,22,'pct',true),
('services','netMargin',5,10,18,'pct',true),
('services','debtorDays',20,40,60,'days',false),
('services','creditorDays',15,30,45,'days',true),
('services','assetTurnover',0.8,1.5,2.5,'x',true),
('services','roa',5,10,18,'pct',true),
('services','roe',10,20,30,'pct',true),
('services','fixedCostRatio',30,45,60,'pct',false),
('services','salesPerEmployee',80000,150000,250000,'money',true),
-- SAAS
('saas','grossMargin',60,75,85,'pct',true),
('saas','operatingMargin',-10,5,20,'pct',true),
('saas','netMargin',-15,2,18,'pct',true),
('saas','debtorDays',15,30,50,'days',false),
('saas','assetTurnover',0.4,0.8,1.2,'x',true),
('saas','roa',-5,5,15,'pct',true),
('saas','roe',-10,10,25,'pct',true),
('saas','fixedCostRatio',50,65,80,'pct',false),
('saas','salesPerEmployee',150000,250000,400000,'money',true),
-- HOSPITALITY
('hospitality','grossMargin',55,68,78,'pct',true),
('hospitality','operatingMargin',5,12,20,'pct',true),
('hospitality','netMargin',2,6,12,'pct',true),
('hospitality','inventoryDays',5,12,20,'days',false),
('hospitality','creditorDays',20,35,50,'days',true),
('hospitality','assetTurnover',0.6,1.2,1.8,'x',true),
('hospitality','roa',3,8,14,'pct',true),
('hospitality','fixedCostRatio',35,50,65,'pct',false),
-- CONSTRUCTION
('construction','grossMargin',12,20,30,'pct',true),
('construction','operatingMargin',3,6,10,'pct',true),
('construction','netMargin',2,4,7,'pct',true),
('construction','debtorDays',30,55,80,'days',false),
('construction','creditorDays',30,50,75,'days',true),
('construction','assetTurnover',1.2,2.0,3.0,'x',true),
('construction','roa',4,8,14,'pct',true),
('construction','fixedCostRatio',10,18,28,'pct',false),
-- MANUFACTURING
('manufacturing','grossMargin',20,32,45,'pct',true),
('manufacturing','operatingMargin',5,10,16,'pct',true),
('manufacturing','netMargin',3,6,11,'pct',true),
('manufacturing','debtorDays',30,50,70,'days',false),
('manufacturing','inventoryDays',45,75,110,'days',false),
('manufacturing','creditorDays',30,50,70,'days',true),
('manufacturing','assetTurnover',0.8,1.4,2.2,'x',true),
('manufacturing','roa',4,8,13,'pct',true),
('manufacturing','fixedCostRatio',20,30,42,'pct',false),
-- PROFESSIONAL
('professional','grossMargin',45,60,75,'pct',true),
('professional','operatingMargin',12,20,30,'pct',true),
('professional','netMargin',8,15,25,'pct',true),
('professional','debtorDays',25,45,70,'days',false),
('professional','assetTurnover',1.0,1.8,2.8,'x',true),
('professional','roa',8,15,25,'pct',true),
('professional','roe',15,25,40,'pct',true),
('professional','fixedCostRatio',25,40,55,'pct',false),
('professional','salesPerEmployee',120000,200000,350000,'money',true),
-- OTHER (broad averages)
('other','grossMargin',30,45,60,'pct',true),
('other','operatingMargin',5,10,17,'pct',true),
('other','netMargin',3,7,13,'pct',true),
('other','debtorDays',20,40,60,'days',false),
('other','inventoryDays',20,45,75,'days',false),
('other','creditorDays',20,40,60,'days',true),
('other','assetTurnover',1.0,1.7,2.6,'x',true),
('other','roa',4,9,15,'pct',true),
('other','roe',10,18,28,'pct',true),
('other','fixedCostRatio',20,35,50,'pct',false);
