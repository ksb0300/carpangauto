-- 20260924000001_init.sql
-- 카팡 업무관리 — 초기 스키마
-- 설계 근거: docs/똑순이_분석.md
-- 원칙
--   * 로그인한 사람만 접근 (RLS). 대표·직원(admin/staff)은 전체, 딜러(dealer)는 본인 차량만 읽기.
--   * 주민등록번호는 평문 컬럼을 두지 않는다. 암호문(bytea) + 가림표시(masked)만 저장하고,
--     쓰기·열람은 전용 함수로만 한다 (개인정보보호법 §24의2).
--   * 돈이 오가는 테이블은 변경 이력(audit_log)을 남긴다.

create extension if not exists pgcrypto;

-- ───────────────────────── 사용자·권한 ─────────────────────────
create type app_role as enum ('admin', 'staff', 'dealer');

create table dealers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  kind          text not null default '사업자' check (kind in ('사업자', '개인')),
  ssn_masked    text,
  biz_no        text,
  phone         text,
  email         text,
  bank          text,
  account_no    text,
  address       text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
comment on table dealers is '상사 딜러';

create table profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text not null,
  role       app_role not null default 'dealer',
  dealer_id  uuid references dealers(id),
  created_at timestamptz not null default now()
);
comment on table profiles is '로그인 계정 ↔ 역할. 가입은 막고 대표가 초대한 계정만 쓴다';

create or replace function my_role() returns app_role
language sql stable security definer set search_path = public as
$$ select role from profiles where user_id = auth.uid() $$;

create or replace function my_dealer_id() returns uuid
language sql stable security definer set search_path = public as
$$ select dealer_id from profiles where user_id = auth.uid() $$;

create or replace function is_office() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(my_role() in ('admin', 'staff'), false) $$;

-- 새 로그인 계정이 생기면 권한 없는 딜러 행을 만든다 (대표가 역할을 정해줘야 뭔가 보인다).
-- 아직 대표가 한 명도 없으면 그 계정을 대표로 — 대표 본인을 가장 먼저 초대할 것.
create or replace function on_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (user_id, name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email, '새 계정'),
          case when exists (select 1 from profiles where role = 'admin') then 'dealer' else 'admin' end::app_role)
  on conflict (user_id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function on_new_user();

-- ───────────────────────── 설정·마스터 ─────────────────────────
create table settings (
  id                        int primary key default 1 check (id = 1),
  company_name              text not null default '카팡모터스',
  biz_no                    text,
  purchase_fee              int  not null default 600000,   -- 상사매입비
  purchase_fee_to_cost      boolean not null default true,  -- 상품화비용 자동입력
  acq_tax_to_cost           boolean not null default true,
  loan_interest_to_cost     boolean not null default true,
  sale_fee                  int  not null default 440000,   -- 상사매도비
  settle_method             text not null default '일괄' check (settle_method in ('일괄', '분할')),
  cash_issue_form           text not null default '건별' check (cash_issue_form in ('건별', '합산')),
  tax_invoice_self_issue    boolean not null default false, -- 전자세금계산서 자체발행(팝빌) 여부
  updated_at                timestamptz not null default now()
);
insert into settings (id) values (1);

create table lenders (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique,
  credit_limit     bigint not null default 0,
  existing_amount  bigint not null default 0,   -- 똑순이 밖에서 이미 쓰는 금액
  interest_day     int check (interest_day between 1 and 31),
  active           boolean not null default true,
  sort             int not null default 0
);
comment on table lenders is '재고금융사';
insert into lenders (name, sort, active) values
  ('대표자개인대출', 1, true), ('KB캐피탈', 2, true), ('우리캐피탈', 3, true), ('BNK', 4, true), ('기타', 99, true);

create table parking_zones (
  id    uuid primary key default gen_random_uuid(),
  name  text not null,
  memo  text,
  sort  int not null default 0
);
insert into parking_zones (name, sort) values ('A', 1), ('B', 2), ('C', 3);

-- ───────────────────────── 차량(제시) ─────────────────────────
create table cars (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,                        -- 관리번호 YYYYMMDD-001 (트리거가 채움)
  status            text not null default '재고' check (status in ('재고', '매도')),
  consign           text not null default '상사매입' check (consign in ('상사매입', '고객위탁')),
  dealer_id         uuid references dealers(id),
  car_kind          text not null default '승용' check (car_kind in ('승용', '승합', '경차', '화물', '특수')),
  car_name          text not null,
  plate             text not null,                      -- 차량번호(제시후)
  plate_before      text,                               -- 차량번호(제시전)
  purchase_date     date not null default current_date, -- 제시일(조합전산)
  transfer_date     date,                               -- 이전일
  purchase_amount   bigint not null default 0,          -- 제시금액 (부가세 포함)
  purchase_supply   bigint not null default 0,
  purchase_vat      bigint not null default 0,
  purchase_fee      bigint not null default 0,          -- 상사매입비
  acq_tax           bigint not null default 0,          -- (예상)취득세
  evidence          text not null default '의제매입' check (evidence in ('의제매입', '세금계산서', '계산서')),
  seller_name       text,
  seller_type       text not null default '개인' check (seller_type in ('개인', '법인')),
  seller_ssn_masked text,
  seller_biz_no     text,
  seller_phone      text,
  seller_email      text,
  seller_zip        text,
  seller_addr1      text,
  seller_addr2      text,
  contract_no       text,                               -- 관인계약서번호
  invoice_date      date,                               -- 계산서 발행일
  fact_confirm      text check (fact_confirm in ('해당없음', '수취', '미수취')),  -- 비사업용 사실확인서
  memo              text,
  association_memo  text,                               -- 조합제시메모
  parking_zone_id   uuid references parking_zones(id),
  key_no            text,
  deleted_at        timestamptz,
  created_by        uuid references auth.users(id) default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index cars_plate_idx on cars (plate) where deleted_at is null;
create index cars_dealer_idx on cars (dealer_id);
-- 같은 번호판의 미판매 재고는 하나만
create unique index cars_one_stock_per_plate on cars (plate) where deleted_at is null and status = '재고';

create or replace function cars_before_write() returns trigger language plpgsql as $$
declare seq int;
begin
  new.purchase_supply := round(new.purchase_amount / 1.1);
  new.purchase_vat    := new.purchase_amount - new.purchase_supply;
  new.updated_at      := now();
  if tg_op = 'INSERT' and new.code is null then
    select count(*) + 1 into seq from cars where purchase_date = new.purchase_date;
    new.code := to_char(new.purchase_date, 'YYYYMMDD') || '-' || lpad(seq::text, 3, '0');
  end if;
  return new;
end $$;
create trigger cars_before_write before insert or update on cars
  for each row execute function cars_before_write();

-- ───────────────────────── 상품화비용 ─────────────────────────
create table car_costs (
  id                     uuid primary key default gen_random_uuid(),
  car_id                 uuid not null references cars(id) on delete cascade,
  item                   text not null,     -- 상사매입비·취득세·매입탁송비·성능점검비·의무보험료·주유대·판금도장비·기능수리/상품화·광택/세차·광고비·경매장수수료·통행료·이자비용·기타비용
  paid_by                text not null default '딜러' check (paid_by in ('딜러', '상사')),
  taxable                boolean not null default true,
  amount                 bigint not null,
  supply                 bigint not null default 0,
  vat                    bigint not null default 0,
  paid_date              date,
  evidence               text,              -- 전자세금계산서·종이세금계산서·카드·현금영수증·계산서·간이영수증·기타영수증·자료없음
  memo                   text,
  include_in_settlement  boolean not null default true,   -- 정산반영(매입원가로 공제)
  auto_source            text,                            -- '상사매입비' | '취득세' — 제시 등록 시 자동 생성된 행
  sort                   int not null default 0,
  created_at             timestamptz not null default now()
);
create index car_costs_car_idx on car_costs (car_id);

create or replace function car_costs_before_write() returns trigger language plpgsql as $$
begin
  if new.taxable then
    new.supply := round(new.amount / 1.1);
    new.vat    := new.amount - new.supply;
  else
    new.supply := new.amount;
    new.vat    := 0;
  end if;
  return new;
end $$;
create trigger car_costs_before_write before insert or update on car_costs
  for each row execute function car_costs_before_write();

-- 제시 등록·수정 시 상사매입비/취득세 비용 행 자동 반영 (설정이 '예'일 때)
create or replace function cars_sync_auto_costs() returns trigger language plpgsql security definer set search_path = public as $$
declare s settings;
begin
  select * into s from settings where id = 1;
  if s.purchase_fee_to_cost then
    delete from car_costs where car_id = new.id and auto_source = '상사매입비';
    if new.purchase_fee > 0 then
      insert into car_costs (car_id, item, paid_by, taxable, amount, paid_date, evidence, include_in_settlement, auto_source, sort)
      values (new.id, '상사매입비', '딜러', true, new.purchase_fee, new.purchase_date, '현금영수증', true, '상사매입비', -2);
    end if;
  end if;
  if s.acq_tax_to_cost then
    delete from car_costs where car_id = new.id and auto_source = '취득세';
    if new.acq_tax > 0 then
      insert into car_costs (car_id, item, paid_by, taxable, amount, paid_date, include_in_settlement, auto_source, sort)
      values (new.id, '취득세', '딜러', false, new.acq_tax, coalesce(new.transfer_date, new.purchase_date), true, '취득세', -1);
    end if;
  end if;
  return new;
end $$;
create trigger cars_sync_auto_costs after insert or update of purchase_fee, acq_tax, purchase_date, transfer_date on cars
  for each row execute function cars_sync_auto_costs();

-- ───────────────────────── 재고금융 ─────────────────────────
create table car_loans (
  id            uuid primary key default gen_random_uuid(),
  car_id        uuid not null references cars(id) on delete cascade,
  lender_id     uuid not null references lenders(id),
  kind          text not null default '신규' check (kind in ('신규', '추가', '연장')),
  status        text not null default '진행중' check (status in ('진행중', '상환완료')),
  amount        bigint not null,
  start_date    date not null,
  months        int not null check (months > 0),
  lender_rate   numeric(6,3),        -- 캐피탈이율 (연 %)
  dealer_rate   numeric(6,3) not null, -- 딜러이율 (연 %)
  repaid_date   date,
  memo          text,
  created_at    timestamptz not null default now()
);
create index car_loans_car_idx on car_loans (car_id);

create table loan_payments (
  id          uuid primary key default gen_random_uuid(),
  loan_id     uuid not null references car_loans(id) on delete cascade,
  amount      bigint not null,
  paid_date   date not null,
  created_at  timestamptz not null default now()
);

-- 상환완료면 수정·삭제 잠금 (먼저 상환완료 취소)
create or replace function car_loans_lock() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and old.status = '상환완료' then
    raise exception '상환완료된 재고금융은 삭제할 수 없습니다. 상환완료를 먼저 취소하세요.';
  end if;
  if tg_op = 'UPDATE' and old.status = '상환완료' and new.status = '상환완료' then
    raise exception '상환완료된 재고금융은 수정할 수 없습니다. 상환완료를 먼저 취소하세요.';
  end if;
  return coalesce(new, old);
end $$;
create trigger car_loans_lock before update or delete on car_loans
  for each row execute function car_loans_lock();

-- ───────────────────────── 매도 ─────────────────────────
create table car_sales (
  car_id          uuid primary key references cars(id) on delete cascade,
  sale_date       date not null,
  dealer_id       uuid references dealers(id),
  other_dealer    boolean not null default false,   -- 타상사딜러
  sale_type       text not null default '소매' check (sale_type in ('소매', '도매', '경매', '수출', '폐차')),
  sale_amount     bigint not null,
  sale_supply     bigint not null default 0,
  sale_vat        bigint not null default 0,
  plate_out       text,
  sale_fee        bigint not null default 0,        -- 상사매도비 (상사 매출)
  perf_insurance  bigint not null default 0,        -- 성능보험료 (상사 매출)
  memo            text,
  created_at      timestamptz not null default now()
);

create or replace function car_sales_before_write() returns trigger language plpgsql as $$
begin
  new.sale_supply := round(new.sale_amount / 1.1);
  new.sale_vat    := new.sale_amount - new.sale_supply;
  return new;
end $$;
create trigger car_sales_before_write before insert or update on car_sales
  for each row execute function car_sales_before_write();

create or replace function car_sales_status() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from settlements where car_id = old.car_id and finalized) then
      raise exception '정산완료된 차량은 매도취소할 수 없습니다. 정산 확정을 먼저 해제하세요.';
    end if;
    update cars set status = '재고' where id = old.car_id;
    delete from settlements where car_id = old.car_id;   -- 임시정산도 함께 정리 (똑순이는 남겨둠)
    return old;
  end if;
  update cars set status = '매도' where id = new.car_id;
  return new;
end $$;
create trigger car_sales_status after insert or delete on car_sales
  for each row execute function car_sales_status();

create table car_buyers (
  id          uuid primary key default gen_random_uuid(),
  car_id      uuid not null references car_sales(car_id) on delete cascade,
  name        text not null,
  ssn_masked  text,
  biz_no      text,
  phone       text,
  zip         text,
  addr        text,
  memo        text,
  share_rate  numeric(5,2) not null default 100,
  sort        int not null default 0
);

-- ───────────────────────── 정산 ─────────────────────────
create table settlements (
  car_id          uuid primary key references cars(id) on delete cascade,
  settle_date     date not null default current_date,
  withholding     boolean not null default true,     -- 원천징수 대상
  method          text not null check (method in ('일괄', '분할')),
  allow_negative  boolean not null default false,
  other_revenue   jsonb not null default '[]',        -- 기타 매출 [{항목, 금액, 과세}]
  offsets         jsonb not null default '[]',        -- 상계 [{항목, 금액}] (재고금융·미납이자·기타)
  loan_repay      boolean not null default true,     -- 정산완료 시 재고금융 상환완료 처리
  memo            text,
  -- 계산 결과 (calc.js 정산() 과 같은 값) — 조회·집계용
  sale_total      bigint, purchase_total bigint, cost_total bigint,
  base_amount     bigint, base_supply bigint, base_vat bigint,   -- D
  income_amount   bigint, income_tax bigint, local_tax bigint, tax_total bigint,
  offset_total    bigint, payout bigint, net_income bigint,
  detail          jsonb,                             -- 계산 전체 스냅샷
  finalized       boolean not null default false,
  finalized_at    timestamptz,
  updated_at      timestamptz not null default now()
);

create or replace function settlements_finalize() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.finalized and not coalesce(old.finalized, false) then
    new.finalized_at := now();
    if new.loan_repay then
      update car_loans set status = '상환완료', repaid_date = new.settle_date
       where car_id = new.car_id and status = '진행중';
    end if;
  end if;
  -- 확정 해제: 이 정산이 상환완료로 바꾼 대출을 되돌린다 (다시 정산할 때 재고금융 상계가 빠지지 않게)
  if tg_op = 'UPDATE' and old.finalized and not new.finalized then
    new.finalized_at := null;
    if old.loan_repay then
      update car_loans set status = '진행중', repaid_date = null
       where car_id = new.car_id and status = '상환완료' and repaid_date = old.settle_date;
    end if;
  end if;
  if tg_op = 'UPDATE' and old.finalized and new.finalized
     and (new.detail is distinct from old.detail) then
    raise exception '정산완료 상태에서는 금액을 바꿀 수 없습니다. 정산 확정을 먼저 해제하세요.';
  end if;
  return new;
end $$;
create trigger settlements_finalize before insert or update on settlements
  for each row execute function settlements_finalize();

-- ───────────────────────── 상사 매출·지출·운영비 ─────────────────────────
create table ledger_entries (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('매출', '지출', '운영비')),
  ym            text not null check (ym ~ '^\d{4}-\d{2}$'),
  item          text not null,
  amount        bigint not null,
  taxable       boolean not null default true,
  supply        bigint,
  vat           bigint,
  entry_date    date,
  pay_method    text,     -- 계좌이체·카드·자동이체·지로·현금
  evidence      text,     -- 미발행·현금영수증·전자세금계산서·카드결제
  invoice_date  date,
  memo          text,
  car_id        uuid references cars(id) on delete set null,
  dealer_id     uuid references dealers(id),
  created_at    timestamptz not null default now()
);

-- ───────────────────────── 주민번호 암호화 ─────────────────────────
-- 키는 Supabase Vault 의 'ssn_key' 에 둔다:  select vault.create_secret('<긴 무작위 문자열>', 'ssn_key');
create or replace function _ssn_key() returns text
language sql stable security definer set search_path = public, vault as
$$ select decrypted_secret from vault.decrypted_secrets where name = 'ssn_key' $$;

create or replace function _mask_ssn(ssn text) returns text language sql immutable as $$
  select case when ssn is null or ssn = '' then null
              else left(regexp_replace(ssn, '\D', '', 'g'), 6) || '-' ||
                   substr(regexp_replace(ssn, '\D', '', 'g'), 7, 1) || '******' end
$$;

create table ssn_access_log (
  id          bigint generated always as identity primary key,
  user_id     uuid default auth.uid(),
  target      text not null,
  target_id   uuid not null,
  action      text not null check (action in ('write', 'reveal')),
  at          timestamptz not null default now()
);

-- 암호문은 API 로 닿지 않는 별도 테이블에만 둔다 (RLS 켜고 정책 없음 → 전용 함수만 접근).
create table pii_ssn (
  target     text not null check (target in ('car_seller', 'buyer', 'dealer')),
  target_id  uuid not null,
  enc        bytea not null,
  updated_at timestamptz not null default now(),
  primary key (target, target_id)
);
alter table pii_ssn enable row level security;
revoke all on pii_ssn from anon, authenticated;

create or replace function set_ssn(p_target text, p_id uuid, p_ssn text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare masked text := _mask_ssn(p_ssn);
begin
  if not is_office() then raise exception '권한이 없습니다'; end if;
  if p_target not in ('car_seller', 'buyer', 'dealer') then raise exception '알 수 없는 대상: %', p_target; end if;
  if p_ssn is null or p_ssn = '' then
    delete from pii_ssn where target = p_target and target_id = p_id;
  else
    insert into pii_ssn as x (target, target_id, enc) values (p_target, p_id, pgp_sym_encrypt(p_ssn, _ssn_key()))
    on conflict on constraint pii_ssn_pkey do update set enc = excluded.enc, updated_at = now();
  end if;
  if p_target = 'car_seller' then update cars set seller_ssn_masked = masked where id = p_id;
  elsif p_target = 'buyer' then update car_buyers set ssn_masked = masked where id = p_id;
  else update dealers set ssn_masked = masked where id = p_id;
  end if;
  insert into ssn_access_log (target, target_id, action) values (p_target, p_id, 'write');
  return masked;
end $$;

create or replace function reveal_ssn(p_target text, p_id uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare e bytea;
begin
  if my_role() is distinct from 'admin' then raise exception '주민번호 원문은 대표만 볼 수 있습니다'; end if;
  select enc into e from pii_ssn where target = p_target and target_id = p_id;
  insert into ssn_access_log (target, target_id, action) values (p_target, p_id, 'reveal');
  return case when e is null then null else pgp_sym_decrypt(e, _ssn_key()) end;
end $$;

-- ───────────────────────── 변경 이력 ─────────────────────────
create table audit_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  row_id      text,
  action      text not null,
  old_data    jsonb,
  new_data    jsonb,
  user_id     uuid default auth.uid(),
  at          timestamptz not null default now()
);

create or replace function audit() returns trigger language plpgsql security definer set search_path = public as $$
declare o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
        n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
begin
  insert into audit_log (table_name, row_id, action, old_data, new_data)
  values (tg_table_name, coalesce(n->>'id', n->>'car_id', o->>'id', o->>'car_id'), tg_op, o, n);
  return coalesce(new, old);
end $$;

do $$ declare t text; begin
  foreach t in array array['cars','car_costs','car_loans','loan_payments','car_sales','car_buyers','settlements','ledger_entries','dealers','settings','lenders']
  loop execute format('create trigger %I_audit after insert or update or delete on %I for each row execute function audit()', t, t);
  end loop;
end $$;

-- ───────────────────────── RLS ─────────────────────────
do $$ declare t text; begin
  foreach t in array array['dealers','profiles','settings','lenders','parking_zones','cars','car_costs','car_loans','loan_payments',
                           'car_sales','car_buyers','settlements','ledger_entries','ssn_access_log','audit_log']
  loop execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- 사무실(대표·직원): 전부
do $$ declare t text; begin
  foreach t in array array['dealers','settings','lenders','parking_zones','cars','car_costs','car_loans','loan_payments',
                           'car_sales','car_buyers','settlements','ledger_entries']
  loop execute format('create policy office_all on %I for all to authenticated using (is_office()) with check (is_office())', t);
  end loop;
end $$;

-- 계정 관리·이력 열람은 대표만
create policy profiles_admin on profiles for all to authenticated using (my_role() = 'admin') with check (my_role() = 'admin');
create policy profiles_self on profiles for select to authenticated using (user_id = auth.uid());
create policy audit_admin on audit_log for select to authenticated using (my_role() = 'admin');
create policy ssnlog_admin on ssn_access_log for select to authenticated using (my_role() = 'admin');

-- 딜러: 본인 차량과 거기 딸린 것만 읽기
create policy dealer_cars on cars for select to authenticated
  using (my_role() = 'dealer' and dealer_id = my_dealer_id() and deleted_at is null);
create policy dealer_costs on car_costs for select to authenticated
  using (my_role() = 'dealer' and exists (select 1 from cars c where c.id = car_id and c.dealer_id = my_dealer_id()));
create policy dealer_loans on car_loans for select to authenticated
  using (my_role() = 'dealer' and exists (select 1 from cars c where c.id = car_id and c.dealer_id = my_dealer_id()));
create policy dealer_payments on loan_payments for select to authenticated
  using (my_role() = 'dealer' and exists (select 1 from car_loans l join cars c on c.id = l.car_id
                                          where l.id = loan_id and c.dealer_id = my_dealer_id()));
create policy dealer_sales on car_sales for select to authenticated
  using (my_role() = 'dealer' and exists (select 1 from cars c where c.id = car_id and c.dealer_id = my_dealer_id()));
create policy dealer_settlements on settlements for select to authenticated
  using (my_role() = 'dealer' and exists (select 1 from cars c where c.id = car_id and c.dealer_id = my_dealer_id()));
create policy dealer_lookup_lenders on lenders for select to authenticated using (true);
create policy dealer_lookup_settings on settings for select to authenticated using (true);
create policy dealer_self on dealers for select to authenticated using (id = my_dealer_id());


-- 20261001000001_full.sql
-- 카팡 업무관리 — 2단계: 발행(현금영수증·세금계산서), 통장, 알선, 첨부, 문자, 상사정보
-- 설계 근거: docs/똑순이_분석.md §2·§4·§7
-- 원칙
--   * 팝빌 비밀키는 DB·브라우저에 두지 않는다. 발행·조회는 서버 함수(Edge Function)만 한다.
--   * 홈택스에서 직접 발행한 건도 기록할 수 있게, 발행 상태는 '수기'로도 바꿀 수 있다(issued_via).
--   * 발행·취소된 문서는 금액·상대방을 못 바꾸고 지울 수 없다.

-- ───────────────────────── 상사정보·운영설정 추가 ─────────────────────────
alter table settings
  add column ceo_name        text,
  add column biz_type        text,               -- 업태
  add column biz_item        text,               -- 종목
  add column tel             text,
  add column fax             text,
  add column email           text,
  add column address         text,
  add column association_code text,              -- 조합상사코드
  add column popbill_user_id text,               -- 팝빌 연동회원 아이디
  add column sms_sender      text,               -- 문자 발신번호(팝빌에 등록된 번호)
  add column revenue_items   jsonb not null default '["잡수입","매도계약금","통입금","대입금","매도수수료","기타매출"]',
  add column expense_items   jsonb not null default '["상사임대료","상사관리비","인건비","기장료","단지월회비","복사기임대료","통신요금","광고비","기타지출"]';

-- 매도 건별 증빙 계획: 항목마다 어떤 증빙으로 처리할지, 매수자별 결제비율
alter table car_sales
  add column evidence_plan jsonb not null default '{}',   -- {"차량대금":"현금영수증","상사매도비":"카드결제",...}
  add column pay_shares    jsonb not null default '{}';   -- {"<buyer_id>": 50, ...} 비어 있으면 지분율

-- ───────────────────────── 발행 문서 (현금영수증·세금계산서) ─────────────────────────
create table issue_docs (
  id              uuid primary key default gen_random_uuid(),
  doc_type        text not null check (doc_type in ('현금영수증', '세금계산서')),
  status          text not null default '대기' check (status in ('대기', '발행', '취소', '실패')),
  issued_via      text check (issued_via in ('팝빌', '수기', '데모')),
  source          text not null default '기타',   -- 차량대금·상사매도비·성능보험료·상사매입비·알선수수료·기타
  car_id          uuid references cars(id) on delete set null,
  buyer_id        uuid references car_buyers(id) on delete set null,
  dealer_id       uuid references dealers(id) on delete set null,
  brokerage_id    uuid,                           -- brokerages(id) — 아래에서 FK
  trade_date      date not null default current_date,
  usage           text check (usage in ('소득공제용', '지출증빙용')),   -- 현금영수증
  purpose         text check (purpose in ('영수', '청구')),           -- 세금계산서
  taxable         boolean not null default true,
  amount          bigint not null check (amount > 0),
  supply          bigint not null default 0,
  vat             bigint not null default 0,
  item_name       text not null,
  customer_name   text,
  identity        text,          -- 현금영수증 식별번호: 휴대폰·사업자번호·카드번호 (주민번호는 받지 않는다)
  biz_no          text,          -- 세금계산서 공급받는자
  corp_name       text,
  ceo_name        text,
  addr            text,
  biz_type        text,
  biz_item        text,
  email           text,
  phone           text,
  mgt_key         text unique,   -- 팝빌 문서번호 (트리거가 채움)
  confirm_num     text,          -- 국세청 승인번호
  issued_at       timestamptz,
  cancel_mgt_key  text,
  cancel_confirm_num text,
  cancelled_at    timestamptz,
  error           text,
  result          jsonb,
  memo            text,
  created_by      uuid references auth.users(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  constraint identity_not_ssn check (identity is null or length(regexp_replace(identity, '\D', '', 'g')) <> 13)
);
create index issue_docs_car_idx on issue_docs (car_id);
create index issue_docs_status_idx on issue_docs (status, trade_date);
comment on column issue_docs.identity is '현금영수증 식별번호. 개인정보 보호를 위해 주민번호(13자리) 입력은 막는다';

create or replace function issue_docs_before_write() returns trigger language plpgsql as $$
declare seq int;
begin
  if tg_op = 'UPDATE' and old.status in ('발행', '취소') then
    if (new.amount, new.taxable, new.doc_type, coalesce(new.identity, ''), coalesce(new.biz_no, ''), new.trade_date, new.item_name)
       is distinct from (old.amount, old.taxable, old.doc_type, coalesce(old.identity, ''), coalesce(old.biz_no, ''), old.trade_date, old.item_name) then
      raise exception '발행된 문서는 금액·상대방을 바꿀 수 없습니다. 취소 후 새로 발행하세요.';
    end if;
    if old.status = '취소' and new.status <> '취소' then raise exception '취소된 문서는 되살릴 수 없습니다.'; end if;
    if old.status = '발행' and new.status not in ('발행', '취소') then raise exception '발행된 문서는 취소만 할 수 있습니다.'; end if;
  end if;
  if new.taxable then
    new.supply := round(new.amount / 1.1);
    new.vat    := new.amount - new.supply;
  else
    new.supply := new.amount;
    new.vat    := 0;
  end if;
  if new.doc_type = '현금영수증' and new.usage is null then new.usage := '소득공제용'; end if;
  if new.doc_type = '세금계산서' and new.purpose is null then new.purpose := '영수'; end if;
  if tg_op = 'INSERT' and new.mgt_key is null then
    -- 팝빌 문서번호: 영문·숫자·-_ 최대 24자. CP + 날짜 + 일련번호
    select count(*) + 1 into seq from issue_docs where mgt_key like 'CP' || to_char(now(), 'YYYYMMDD') || '-%';
    new.mgt_key := 'CP' || to_char(now(), 'YYYYMMDD') || '-' || lpad(seq::text, 4, '0') || '-' || substr(md5(random()::text), 1, 4);
  end if;
  if new.status = '발행' and new.issued_at is null then new.issued_at := now(); end if;
  if new.status = '취소' and new.cancelled_at is null then new.cancelled_at := now(); end if;
  return new;
end $$;
create trigger issue_docs_before_write before insert or update on issue_docs
  for each row execute function issue_docs_before_write();

create or replace function issue_docs_no_delete() returns trigger language plpgsql as $$
begin
  if old.status in ('발행', '취소') then
    raise exception '발행·취소된 문서는 지울 수 없습니다 (국세청 기록과 맞춰야 합니다).';
  end if;
  return old;
end $$;
create trigger issue_docs_no_delete before delete on issue_docs
  for each row execute function issue_docs_no_delete();

-- ───────────────────────── 타상사 알선매도 ─────────────────────────
create table brokerages (
  id             uuid primary key default gen_random_uuid(),
  dealer_id      uuid references dealers(id),      -- 알선딜러
  item           text not null default '알선수수료' check (item in ('알선수수료', '알선수익금')),
  sale_date      date not null default current_date,
  plate          text,
  car_name       text,
  customer_name  text,                             -- 고객/상사명
  other_dealer   text,                             -- 타상사 딜러
  phone          text,
  fee            bigint not null check (fee >= 0),  -- 알선수수료(부가세 포함)
  deduct_cost    bigint not null default 0,         -- 공제비용(상품화 등)
  withholding    boolean not null default true,
  method         text not null default '일괄' check (method in ('일괄', '분할')),
  base_amount    bigint, supply bigint, vat bigint,
  income_tax     bigint, local_tax bigint, tax_total bigint, payout bigint,
  evidence       text not null default '미발행',    -- 미발행·현금영수증·세금계산서·카드
  memo           text,
  created_at     timestamptz not null default now()
);
alter table issue_docs add constraint issue_docs_brokerage_fk foreign key (brokerage_id) references brokerages(id) on delete set null;

-- ───────────────────────── 통장 ─────────────────────────
create table bank_accounts (
  id              uuid primary key default gen_random_uuid(),
  bank_code       text,                -- 팝빌 기관코드 4자리 (예: 0004 국민, 0088 신한)
  bank_name       text not null,
  account_no      text not null,
  alias           text,
  popbill         boolean not null default false,   -- 팝빌 계좌조회에 등록된 계좌
  active          boolean not null default true,
  last_synced_at  timestamptz,
  created_at      timestamptz not null default now(),
  unique (bank_name, account_no)
);

create table bank_txs (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references bank_accounts(id) on delete cascade,
  tid         text not null,              -- 팝빌 거래 고유번호, 엑셀 올리기는 내용으로 만든 해시
  tx_date     date not null,
  tx_time     text,
  deposit     bigint not null default 0,  -- 입금
  withdraw    bigint not null default 0,  -- 출금
  balance     bigint,
  remark      text,                       -- 적요·보낸분/받는분
  memo        text,
  match_kind  text check (match_kind in ('차량매도대금', '차량매입대금', '딜러정산지급', '상품화비', '재고금융', '알선', '상사매출', '운영비', '기타')),
  car_id      uuid references cars(id) on delete set null,
  dealer_id   uuid references dealers(id) on delete set null,
  matched_by  text check (matched_by in ('자동', '수동')),
  source      text not null default '팝빌' check (source in ('팝빌', '엑셀', '데모')),
  created_at  timestamptz not null default now(),
  unique (account_id, tid)
);
create index bank_txs_date_idx on bank_txs (tx_date);

-- ───────────────────────── 첨부서류 ─────────────────────────
create table car_files (
  id          uuid primary key default gen_random_uuid(),
  car_id      uuid not null references cars(id) on delete cascade,
  kind        text not null default '기타' check (kind in ('제시', '매도', '정산', '기타')),
  name        text not null,
  path        text not null unique,      -- 저장소 경로 (car-files 버킷)
  size        bigint,
  mime        text,
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now()
);

-- ───────────────────────── 보낸 문자 ─────────────────────────
create table sent_messages (
  id          uuid primary key default gen_random_uuid(),
  to_phone    text not null,
  to_name     text,
  subject     text,
  body        text not null,
  car_id      uuid references cars(id) on delete set null,
  result      text,                      -- 접수번호 또는 오류
  ok          boolean not null default false,
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now()
);

-- 장부 행 부가세 분리 (1단계에서 컬럼만 있었다)
create or replace function ledger_before_write() returns trigger language plpgsql as $$
begin
  if new.taxable then new.supply := round(new.amount / 1.1); new.vat := new.amount - new.supply;
  else new.supply := new.amount; new.vat := 0; end if;
  if new.ym is null and new.entry_date is not null then new.ym := to_char(new.entry_date, 'YYYY-MM'); end if;
  return new;
end $$;
create trigger ledger_before_write before insert or update on ledger_entries
  for each row execute function ledger_before_write();

-- ───────────────────────── 이력·권한 ─────────────────────────
do $$ declare t text; begin
  foreach t in array array['issue_docs','brokerages','bank_accounts','bank_txs','car_files','sent_messages']
  loop
    execute format('create trigger %I_audit after insert or update or delete on %I for each row execute function audit()', t, t);
    execute format('alter table %I enable row level security', t);
    execute format('create policy office_all on %I for all to authenticated using (is_office()) with check (is_office())', t);
  end loop;
end $$;

-- 딜러: 본인 알선 건과 본인 차량의 발행 문서만 읽기
create policy dealer_brokerages on brokerages for select to authenticated
  using (my_role() = 'dealer' and dealer_id = my_dealer_id());
create policy dealer_docs on issue_docs for select to authenticated
  using (my_role() = 'dealer' and exists (select 1 from cars c where c.id = car_id and c.dealer_id = my_dealer_id()));

-- ───────────────────────── 첨부 저장소 (Supabase Storage) ─────────────────────────
-- 데모(PGlite)에는 storage 스키마가 없으므로 있을 때만 만든다.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('car-files', 'car-files', false) on conflict (id) do nothing;
    execute $p$create policy car_files_office on storage.objects for all to authenticated
      using (bucket_id = 'car-files' and public.is_office()) with check (bucket_id = 'car-files' and public.is_office())$p$;
  end if;
end $$;


-- 20261001000002_tierone.sql
-- 사명 변경: 카팡모터스 → TierONE (2026-10-01, 사업자등록증 상호 변경 완료)
alter table settings alter column company_name set default 'TierONE';
update settings set company_name = 'TierONE' where company_name in ('카팡모터스', '카팡');


-- 20261001000003_tsn_parity.sql
-- 똑순이와 기능 맞추기 (2026-10-01)
--  · 매도의 알선딜러 + 정산의 알선딜러 몫 (똑순이 ALSON_* / OWNER_DLR_PAY_AMT)
--  · 재고금융 연장 이력

alter table car_sales
  add column broker_dealer_id uuid references dealers(id);            -- 알선딜러 (차주딜러 외에 팔아 준 딜러)

alter table settlements
  add column broker_dealer_id     uuid references dealers(id),
  add column broker_amount        bigint not null default 0,          -- 정산기준금액 중 알선딜러 몫
  add column broker_withholding   boolean not null default true,
  add column broker_income        bigint not null default 0,
  add column broker_income_tax    bigint not null default 0,
  add column broker_local_tax     bigint not null default 0,
  add column broker_tax_total     bigint not null default 0,
  add column broker_payout        bigint not null default 0;          -- 알선딜러 실지급액
comment on column settlements.payout is '차주딜러 실지급액 (알선 몫을 뺀 금액)';

alter table car_loans
  add column extended_months int not null default 0;                   -- 연장한 개월 수 합 (months 에 이미 더해져 있음)

-- 딜러: 알선딜러로 들어간 정산도 본인 것이면 읽기
create policy dealer_settlements_broker on settlements for select to authenticated
  using (my_role() = 'dealer' and broker_dealer_id = my_dealer_id());


-- 20261003000001_kaiwa.sql
-- 성능점검(KAIWA) 연동: 점검 이력, 차량 기본정보 자동 채우기, 기록부 PDF 첨부, 만료 알림 표시

-- 차량 기본정보 (성능기록부에서 비어 있을 때만 채운다)
alter table cars
  add column vin            text,   -- 차대번호
  add column model_year     text,   -- 연식
  add column first_reg_date date,   -- 최초등록일
  add column mileage        int,    -- 주행거리(km, 점검 당시)
  add column fuel           text,
  add column transmission   text,
  add column motor_type     text;   -- 원동기형식

-- 기록부 PDF 는 '성능' 으로 분류
alter table car_files drop constraint if exists car_files_kind_check;
alter table car_files add constraint car_files_kind_check check (kind in ('제시', '매도', '정산', '성능', '기타'));

create table car_inspections (
  id           uuid primary key default gen_random_uuid(),
  car_id       uuid not null references cars(id) on delete cascade,
  source       text not null default 'KAIWA',
  reserve_id   bigint unique,          -- KAIWA 예약번호 (같은 점검 두 번 안 넣는다)
  check_no     text,                   -- 성능번호
  recept_date  date not null,          -- 접수(점검)일
  expire_date  date,                   -- 성능점검 유효기한
  place        text,                   -- 점검장
  insurer      text,                   -- 보증보험사
  check_price  int not null default 0, -- 점검비
  insur_price  int not null default 0, -- 성능보험료
  mileage      int,
  result       jsonb not null default '{}',   -- 사고이력·단순수리·침수·렌트·튜닝 등 체크 결과
  warnings     text[] not null default '{}',
  file_id      uuid references car_files(id) on delete set null,
  cost_id      uuid references car_costs(id) on delete set null,
  alerted_at   timestamptz,            -- 만료 임박 알림 보낸 시각
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index car_inspections_car_idx on car_inspections (car_id, recept_date desc);

create trigger car_inspections_audit after insert or update or delete on car_inspections for each row execute function audit();
alter table car_inspections enable row level security;
create policy office_all on car_inspections for all to authenticated using (is_office()) with check (is_office());
create policy dealer_inspections on car_inspections for select to authenticated
  using (my_role() = 'dealer' and exists (select 1 from cars c where c.id = car_id and c.dealer_id = my_dealer_id()));


-- 20261003000002_kaiwa_check_cost.sql
-- 성능점검비도 KAIWA 에서 끌어와 상품화비용으로 자동 등록 (보험료와 별도 행)
alter table car_inspections add column check_cost_id uuid references car_costs(id) on delete set null;


-- 20261003000003_partners.sql
-- 공동대표 구조: 매입담당이 '대표'인 차는 딜러 차처럼 정산하지 않는다.
--   · 상사매입비 없음 (대표 본인 회사라 떼어 갈 곳이 없다)
--   · 원천징수·딜러 지급·딜러 이자 없음
--   · 차량 손익(상사매도비 포함, 부가세 뺀 기준)이 그 대표의 실적. 회사 수익은 대표 손익의 합이고 3등분한다.
-- 딜러를 새로 뽑으면 그 딜러 차는 지금까지의 딜러 방식 그대로.

alter table dealers add column partner boolean not null default false;
comment on column dealers.partner is '공동대표 (상사매입비·원천징수·딜러이자 없음, 차량 손익이 본인 실적)';

alter table settlements add column mode text not null default '딜러' check (mode in ('딜러', '대표'));
comment on column settlements.mode is '딜러: 딜러 정산(원천징수·지급) / 대표: 손익 확정만 (지급 없음, base_amount·net_income = 차량 손익)';

-- 대표 차는 상사매입비 0
create or replace function cars_partner_fee() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from dealers where id = new.dealer_id and partner) then new.purchase_fee := 0; end if;
  return new;
end $$;
create trigger cars_partner_fee before insert or update of purchase_fee, dealer_id on cars
  for each row execute function cars_partner_fee();

-- 담당만 바꿔도(일괄 변경) 상사매입비 비용 행이 따라가게
drop trigger cars_sync_auto_costs on cars;
create trigger cars_sync_auto_costs after insert or update of purchase_fee, acq_tax, purchase_date, transfer_date, dealer_id on cars
  for each row execute function cars_sync_auto_costs();

-- 수출로 팔면 성능점검비 22,000원 환급 (점검비 행이 있을 때만, 매도유형을 바꾸거나 매도취소하면 지운다)
create or replace function car_sales_export_refund() returns trigger language plpgsql security definer set search_path = public as $$
declare cid uuid := coalesce(new.car_id, old.car_id);
begin
  delete from car_costs where car_id = cid and auto_source = '수출환급';
  if tg_op <> 'DELETE' and new.sale_type = '수출'
     and exists (select 1 from car_costs where car_id = cid and item = '성능점검비') then
    insert into car_costs (car_id, item, paid_by, taxable, amount, paid_date, include_in_settlement, auto_source, sort, memo)
    values (cid, '성능점검비 환급', '딜러', true, -22000, new.sale_date, true, '수출환급', 11, '수출 매도 — 성능점검비 환급');
  end if;
  return coalesce(new, old);
end $$;
create trigger car_sales_export_refund after insert or update of sale_type, sale_date or delete on car_sales
  for each row execute function car_sales_export_refund();

-- 딜러(권한 없음) 계정은 업무관리 데이터에 접근 금지 — 공동대표(admin)·사무장(staff)만 본다.
-- 딜러는 로그인 없이 '매입담당' 명단(dealers)으로만 관리한다.
drop policy dealer_cars on cars;
drop policy dealer_costs on car_costs;
drop policy dealer_loans on car_loans;
drop policy dealer_payments on loan_payments;
drop policy dealer_sales on car_sales;
drop policy dealer_settlements on settlements;
drop policy dealer_settlements_broker on settlements;
drop policy dealer_lookup_lenders on lenders;
drop policy dealer_lookup_settings on settings;
drop policy dealer_self on dealers;
drop policy dealer_brokerages on brokerages;
drop policy dealer_docs on issue_docs;
drop policy dealer_inspections on car_inspections;


-- 20261003000004_ledger_parity.sql
-- 매입매출 관리대장(엑셀)에서 해 오던 것들
--   · 매입처 + 매입수수료 자동 (헤이딜러 제로/셀프·엔카 60만원, 설정에서 바꿈)
--   · 판매유형: 내수판매 / 수출 / 엔카믿고 / 알선판매  (엔카믿고 매도비 242,000)
--   · 수출이면 성능점검비를 22,000원으로 (돌리면 원래 금액)
--   · 할부금융 수수료: 할부금액 × 할부피% − 원천징수(3.3%, 10원 미만 절사) = 수익
--   · 브랜드·모델·등급 (엔카 차종 정보로 채움)

-- ── 매입처
alter table settings add column purchase_channels jsonb not null default
  '[{"name":"헤이딜러 제로","fee":600000},{"name":"헤이딜러 셀프","fee":600000},{"name":"엔카","fee":600000},{"name":"당근","fee":0},{"name":"신차 및 지인","fee":0},{"name":"대차","fee":0}]';
alter table settings add column sale_fee_encar int not null default 242000;   -- 엔카믿고 매도비
alter table cars add column purchase_channel text;

create or replace function cars_channel_fee() returns trigger language plpgsql security definer set search_path = public as $$
declare fee bigint;
begin
  select (c->>'fee')::bigint into fee from settings s, jsonb_array_elements(s.purchase_channels) c
   where s.id = 1 and c->>'name' = new.purchase_channel;
  delete from car_costs where car_id = new.id and auto_source = '매입수수료';
  if coalesce(fee, 0) > 0 then
    insert into car_costs (car_id, item, paid_by, taxable, amount, paid_date, include_in_settlement, auto_source, sort, memo)
    values (new.id, '매입수수료', '딜러', true, fee, new.purchase_date, true, '매입수수료', -3, new.purchase_channel);
  end if;
  return new;
end $$;
create trigger cars_channel_fee after insert or update of purchase_channel, purchase_date on cars
  for each row execute function cars_channel_fee();

-- ── 판매유형
alter table car_sales drop constraint car_sales_sale_type_check;
update car_sales set sale_type = '내수판매' where sale_type not in ('수출');
alter table car_sales alter column sale_type set default '내수판매';
alter table car_sales add constraint car_sales_sale_type_check check (sale_type in ('내수판매', '수출', '엔카믿고', '알선판매'));

-- ── 수출이면 성능점검비 22,000 (환급 행 대신 금액 자체를 바꾼다)
alter table car_costs add column export_original bigint;     -- 수출로 바꾸기 전 금액 (되돌릴 때 씀)
delete from car_costs where auto_source = '수출환급';
create or replace function car_sales_export_refund() returns trigger language plpgsql security definer set search_path = public as $$
declare cid uuid := coalesce(new.car_id, old.car_id);
begin
  if tg_op <> 'DELETE' and new.sale_type = '수출' then
    update car_costs set export_original = amount, amount = 22000
     where car_id = cid and item = '성능점검비' and export_original is null and amount > 22000;
  else
    update car_costs set amount = export_original, export_original = null
     where car_id = cid and item = '성능점검비' and export_original is not null;
  end if;
  return coalesce(new, old);
end $$;

-- ── 할부금융 수수료
alter table car_sales
  add column installment_amount bigint not null default 0,          -- 할부금액
  add column installment_rate   numeric(6,3) not null default 0,    -- 할부피 (%)
  add column installment_fee    bigint not null default 0,          -- 수수료 = 금액 × 할부피
  add column installment_tax    bigint not null default 0,          -- 원천징수 (소득세 3% + 지방세 0.3%, 각 10원 미만 절사)
  add column installment_income bigint not null default 0;          -- 수익 = 수수료 − 원천징수

create or replace function car_sales_before_write() returns trigger language plpgsql as $$
declare it bigint;
begin
  new.sale_supply := round(new.sale_amount / 1.1);
  new.sale_vat    := new.sale_amount - new.sale_supply;
  new.installment_fee := floor(coalesce(new.installment_amount, 0) * coalesce(new.installment_rate, 0) / 100);
  it := floor(new.installment_fee * 0.03 / 10) * 10;
  new.installment_tax := it + floor(it * 0.1 / 10) * 10;
  new.installment_income := new.installment_fee - new.installment_tax;
  return new;
end $$;

-- ── 브랜드·모델·등급 (엔카 차종)
alter table cars
  add column brand       text,      -- 제조사 (엔카 manufacturerName)
  add column model       text,      -- 모델 (엔카 modelName)
  add column grade       text,      -- 등급
  add column encar_id    bigint,    -- 엔카 매물 번호
  add column jato_id     bigint;    -- 엔카 차종 통합 코드 (jatoVehicleId)


-- 20261003000005_lender_rules.sql
-- 재고금융사마다 다른 조건 (기본기간·연장·이율·연장 조건·상환해지수수료)
--   부산은행: 3개월 + 연장 2개월(총 5), 6.9% 고정
--   JB우리:   3개월 + 연장 2개월, 연장하려면 원금 10% 먼저 상환, 연장분 이율 7.9%
--   상환해지수수료는 금융사별로 확인 중 (방식: 없음 / 정률 / 일할)

alter table lenders
  add column base_months      int not null default 3,          -- 기본 대출기간 (개월)
  add column ext_months       int not null default 0,          -- 연장 가능 (개월, 0 = 연장 불가)
  add column base_rate        numeric(6,3),                    -- 기본 이율 (연 %)
  add column ext_rate         numeric(6,3),                    -- 연장분 이율 (비우면 기본 이율 그대로)
  add column ext_repay_pct    numeric(5,2) not null default 0, -- 연장하려면 먼저 갚아야 할 원금 비율 (%)
  add column repay_fee_method text not null default '없음' check (repay_fee_method in ('없음', '정률', '일할')),
  add column repay_fee_pct    numeric(6,3) not null default 0, -- 상환해지수수료율 (%)
  add column rule_memo        text;                            -- 그 밖의 조건 메모

-- 대출마다 실행 당시 조건을 그대로 남긴다 (나중에 금융사 조건을 바꿔도 지난 대출 계산이 안 바뀌게)
alter table car_loans
  add column base_months       int,                  -- 기본기간 (연장 전)
  add column ext_rate          numeric(6,3),         -- 연장분 이율
  add column ext_start         date,                 -- 연장 시작일 (= 기본 만기일)
  add column principal_repaid  bigint not null default 0,   -- 연장 때 먼저 갚은 원금
  add column repay_fee         bigint;               -- 상환 때 낸 해지수수료

-- 금융사 이름을 실제 이름으로 (매입매출대장과 같게)
update lenders set name = '부산은행' where name = 'BNK';
update lenders set name = 'JB우리' where name = '우리캐피탈';
update lenders set name = 'KB국민' where name = 'KB캐피탈';
insert into lenders (name, sort, active) values ('신한은행', 5, true), ('키움증권', 6, true) on conflict (name) do nothing;

update lenders set base_months = 3, ext_months = 2, base_rate = 6.9, ext_rate = null, ext_repay_pct = 0 where name = '부산은행';
update lenders set base_months = 3, ext_months = 2, base_rate = 6.9, ext_rate = 7.9, ext_repay_pct = 10 where name = 'JB우리';
update lenders set base_rate = 6.9, rule_memo = '기간·연장 조건 확인 필요' where name = 'KB국민';
update lenders set rule_memo = '조건 확인 필요' where name in ('신한은행', '키움증권');

-- 기존 대출에 실행 당시 조건 채우기
update car_loans l set base_months = coalesce(l.base_months, x.base_months), ext_rate = coalesce(l.ext_rate, x.ext_rate)
  from lenders x where x.id = l.lender_id;


-- 20261003000006_car_keys.sql
-- 통합키(fskey) = "모델 | 연료 | 등급 [| 트림]" — carrot/pricelab market_stats.db 의 keys 어휘표를 그대로 올린다.
-- 차명은 여기서 고른다 (같은 이름 체계로 판매율·시세와 바로 이어지게). 올리는 건 kaiwa_sync.py (하루 두 번).

create table car_keys (
  car_type        text not null,          -- domestic / import
  key             text not null,          -- 통합키
  brand           text,                   -- 제조사 (엔카 제조사 코드 → 이름)
  model           text not null,
  fuel            text,
  grade           text,
  trim            text,
  level           text,                   -- grade / trim
  manufacturer_cd text, model_cd text, grade_cd text, grade_detail_cd text,
  stock_now       int,                    -- 엔카 현재 재고 (많이 쓰는 키를 위로)
  sold_90d        int,
  updated_at      text,
  primary key (car_type, key)
);
create index car_keys_codes on car_keys (manufacturer_cd, model_cd, grade_cd);
alter table car_keys enable row level security;
create policy office_read on car_keys for select to authenticated using (is_office());

alter table cars
  add column fskey    text,      -- 통합키
  add column car_type text;      -- domestic / import


-- 20261003000007_dashboard_layout.sql
-- 대시보드 위젯 배치 (계정마다): [{ "id": "todo", "on": true }, ...] 순서대로
alter table profiles add column dashboard jsonb;

-- 본인 배치만 바꿀 수 있게 (profiles 는 대표만 수정 가능하므로 전용 함수로)
create or replace function set_dashboard(p_layout jsonb) returns void
language sql security definer set search_path = public as
$$ update profiles set dashboard = p_layout where user_id = auth.uid() $$;
grant execute on function set_dashboard(jsonb) to authenticated;


-- 20261004000001_joint_purchase.sql
-- 매입담당 '공동매입' — 대표들이 같이 산 차. 대표 차와 같은 규칙(상사매입비·원천징수 없음),
-- 실적은 '공동매입' 줄로 따로 보이고 수익 배분 인원(대표 수)에는 들어가지 않는다.
alter table dealers add column joint boolean not null default false;
comment on column dealers.joint is '공동매입 (대표들이 같이 산 차) — partner=true 와 함께 쓴다';
insert into dealers (name, kind, partner, joint)
select '공동매입', '사업자', true, true where not exists (select 1 from dealers where joint);


-- 20261004000002_insp_renew.sql
-- 성능점검 연장(재점검) 표시: 연장한 날부터 90일을 다시 센다 (그 전엔 만료 임박 목록에서 빠짐)
alter table car_inspections add column renewed_on date;
comment on column car_inspections.renewed_on is '성능점검 연장(재점검)한 날 — 경과일은 이 날부터, expire_date 도 같이 늘린다';


-- 20261004000003_list_price.sql
-- 리스트에서 바로 넣는 판매가(매도비 포함) — 마진 = 판매가 − 총원가(매입가 + 재반비용 + 상품화비용)
alter table cars add column list_price bigint;
comment on column cars.list_price is '판매가(매도비 포함) — 리스트에서 바로 입력, 마진 계산용';


-- 20261004000004_sign_docs.sql
-- 서류 작성(비사업용 사실확인서)을 구글 앱스스크립트에서 업무관리로 옮긴다.
-- 고객은 carpangauto.com/sign 에서 입력·서명 → 서버 함수 sign 이 여기 저장 (로그인 없는 공개 함수, service role).
-- 주민번호는 다른 주민번호처럼 pii_ssn 에 암호화해 두고, 표에는 가린 값만. 서명 이미지는 car-files 버킷 sign/<id>.png
create table sign_docs (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null default '비사업용확인서',
  car_no         text not null,
  car_name       text not null,
  name           text not null,
  ssn_masked     text,
  address        text not null,
  phone          text not null,
  biz_no         text,
  agreed         boolean not null default false,
  signature_path text,                                   -- car-files 버킷 경로
  car_id         uuid references cars(id) on delete set null,   -- 같은 번호판의 우리 차 (있으면 자동 연결)
  ua             text,
  ip             text,
  checked_at     timestamptz,                            -- 사무실에서 확인한 때 (대시보드 '새 서류'에서 빠짐)
  checked_by     uuid references auth.users(id),
  created_at     timestamptz not null default now()
);
create index sign_docs_created on sign_docs (created_at desc);
alter table sign_docs enable row level security;
create policy office_all on sign_docs for all to authenticated using (is_office()) with check (is_office());

alter table pii_ssn drop constraint pii_ssn_target_check;
alter table pii_ssn add constraint pii_ssn_target_check check (target in ('car_seller', 'buyer', 'dealer', 'sign_doc'));

-- 서버 함수(sign)만 부른다: 접수 + 주민번호 암호화 + 번호판으로 차 연결을 한 번에. 공개 키로는 못 부르게 막는다.
create or replace function sign_submit(p jsonb, p_ssn text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare nid uuid; cid uuid;
begin
  select id into cid from cars
   where deleted_at is null and regexp_replace(plate, '\s', '', 'g') = regexp_replace(p->>'car_no', '\s', '', 'g')
   order by purchase_date desc limit 1;
  insert into sign_docs (car_no, car_name, name, ssn_masked, address, phone, biz_no, agreed, car_id, ua, ip)
  values (p->>'car_no', p->>'car_name', p->>'name', _mask_ssn(p_ssn), p->>'address', p->>'phone', nullif(p->>'biz_no', ''),
          coalesce((p->>'agreed')::boolean, false), cid, left(p->>'ua', 300), p->>'ip')
  returning id into nid;
  insert into pii_ssn (target, target_id, enc) values ('sign_doc', nid, pgp_sym_encrypt(p_ssn, _ssn_key()));
  return nid;
end $$;
revoke all on function sign_submit(jsonb, text) from public, anon, authenticated;

-- 확인서 지우면 암호문도 같이
create or replace function sign_docs_cleanup() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from pii_ssn where target = 'sign_doc' and target_id = old.id;
  return old;
end $$;
create trigger sign_docs_cleanup after delete on sign_docs for each row execute function sign_docs_cleanup();


-- 20261004000005_extra_income.sql
-- 차량 리스트: 판매가는 매도비를 뺀 차값으로 받고(대장과 같게), 옆에 추가수익(할부 수수료 등 예상) 칸을 둔다.
alter table cars add column extra_income bigint;
-- 이미 넣어 둔 판매가(매도비 포함)는 기본 매도비를 빼서 차값으로 바꾼다
update cars set list_price = list_price - (select sale_fee from settings where id = 1)
 where list_price is not null and list_price > (select sale_fee from settings where id = 1);


-- 20261004000006_installment_company.sql
-- 할부로 판 차: 어느 캐피탈사에 할부를 넣었는지 (재고금융 → 할부실적은 캐피탈사별 할부금액 합계가 핵심)
alter table car_sales add column installment_company text;
-- 매도 화면 캐피탈사 드롭다운 목록 (환경설정에서 고친다)
alter table settings add column installment_companies jsonb not null default
  '["JB우리캐피탈","KB캐피탈","BNK캐피탈","현대캐피탈","하나캐피탈","신한카드","우리금융캐피탈","롯데캐피탈","DGB캐피탈","메리츠캐피탈","오케이캐피탈"]'::jsonb;


-- 20261005000001_ad_price.sql
-- 엔카 광고가: KAIWA 연동(13·18시)이 엔카 매물을 번호판으로 맞춰 넣는다. 리스트는 판매가를 안 넣은 차를 광고가로 '예상마진' 계산
alter table cars add column ad_price bigint;            -- 원 (엔카는 만원 단위)
alter table cars add column ad_price_at timestamptz;    -- 마지막으로 엔카에서 본 때 (광고 내리면 그대로 남고 이 시각이 멈춘다)
-- 광고가가 바뀔 때마다 한 줄 (가격 인하 이력)
create table car_ad_prices (
  id       bigint generated always as identity primary key,
  car_id   uuid not null references cars(id) on delete cascade,
  price    bigint not null,
  seen_at  timestamptz not null default now()
);
create index car_ad_prices_car on car_ad_prices (car_id, seen_at);
alter table car_ad_prices enable row level security;
create policy office_all on car_ad_prices for all to authenticated using (is_office()) with check (is_office());


-- 20261007000001_lender_rates.sql
-- 금융사 조건 갱신 (사용자 2026-10-07)
--   부산은행·KB국민 7.4% (연장 7.4%), JB우리 7.2% (연장 7.2%, 연장 전 원금 9.5% 상환), 신한 모름(그대로),
--   키움증권 기간별 이율: 1~2개월 6.7% / 3~4개월 7.7% / 5~6개월 8.8%
--   저당해지비용 19,300원 — 재고금융을 잡은 모든 차가 상환할 때 낸다 (과거 상환분도 비용으로)
alter table lenders add column release_fee bigint not null default 0;      -- 저당해지비용 (상환 때 한 번)
alter table lenders add column rate_tiers jsonb;                            -- 기간별 이율 [[몇 개월까지, 연 %], …] (키움)
alter table car_loans add column rate_tiers jsonb;                          -- 대출 실행 때 금융사 값을 복사

update lenders set release_fee = 19300 where name in ('부산은행', 'JB우리', 'KB국민', '신한은행', '키움증권');
update lenders set base_rate = 7.4, ext_rate = 7.4, ext_months = greatest(ext_months, 2) where name in ('부산은행', 'KB국민');
update lenders set base_rate = 7.2, ext_rate = 7.2, ext_repay_pct = 9.5 where name = 'JB우리';
update lenders set base_months = 6, ext_months = 0, base_rate = 6.7, ext_rate = null,
  rate_tiers = '[[2, 6.7], [4, 7.7], [6, 8.8]]'::jsonb where name = '키움증권';

-- 진행 중인 대출은 새 이율로 (상환한 대출의 이율은 그대로 — 과거 이율은 사용자 확인 후)
update car_loans cl set lender_rate = 7.4, ext_rate = 7.4 from lenders l
 where l.id = cl.lender_id and l.name in ('부산은행', 'KB국민') and cl.status = '진행중';
update car_loans cl set lender_rate = 7.2, ext_rate = 7.2 from lenders l
 where l.id = cl.lender_id and l.name = 'JB우리' and cl.status = '진행중';
update car_loans cl set lender_rate = 6.7, ext_rate = null, rate_tiers = l.rate_tiers, base_months = 6, months = greatest(cl.months, 6) from lenders l
 where l.id = cl.lender_id and l.name = '키움증권' and cl.status = '진행중';

-- 이미 상환한 대출에도 저당해지비용 (상환완료 잠금을 잠시 풀고)
alter table car_loans disable trigger car_loans_lock;
update car_loans cl set repay_fee = coalesce(cl.repay_fee, 0) + l.release_fee from lenders l
 where l.id = cl.lender_id and l.release_fee > 0 and cl.status = '상환완료' and coalesce(cl.repay_fee, 0) = 0;
alter table car_loans enable trigger car_loans_lock;

-- 정산(손익) 확정 때 자동 상환되는 대출에도 저당해지비용을 붙인다 (확정 해제하면 되돌림)
create or replace function public.settlements_finalize() returns trigger
language plpgsql security definer set search_path to 'public' as $function$
begin
  new.updated_at := now();
  if new.finalized and not coalesce(old.finalized, false) then
    new.finalized_at := now();
    if new.loan_repay then
      update car_loans cl set status = '상환완료', repaid_date = new.settle_date,
             repay_fee = (select nullif(l.release_fee, 0) from lenders l where l.id = cl.lender_id)
       where cl.car_id = new.car_id and cl.status = '진행중';
    end if;
  end if;
  -- 확정 해제: 이 정산이 상환완료로 바꾼 대출을 되돌린다 (다시 정산할 때 재고금융 상계가 빠지지 않게)
  if tg_op = 'UPDATE' and old.finalized and not new.finalized then
    new.finalized_at := null;
    if old.loan_repay then
      update car_loans set status = '진행중', repaid_date = null, repay_fee = null
       where car_id = new.car_id and status = '상환완료' and repaid_date = old.settle_date;
    end if;
  end if;
  if tg_op = 'UPDATE' and old.finalized and new.finalized
     and (new.detail is distinct from old.detail) then
    raise exception '정산완료 상태에서는 금액을 바꿀 수 없습니다. 정산 확정을 먼저 해제하세요.';
  end if;
  return new;
end $function$;


-- 20261008000001_reg_cert.sql
-- 첨부서류 구분에 '등록증'(매입 때 받은 자동차등록증) 추가 — 차 화면 '고객에게 보내기'에서 바로 보낸다
alter table car_files drop constraint if exists car_files_kind_check;
alter table car_files add constraint car_files_kind_check check (kind in ('제시', '매도', '정산', '성능', '등록증', '기타'));


-- 20261008000002_daangn_id.sql
-- 당근중고차 글번호 (엔카 매물 동기화가 당근에 올린 글) — 차 화면 '고객에게 보내기'의 당근 링크
alter table cars add column daangn_id bigint;
