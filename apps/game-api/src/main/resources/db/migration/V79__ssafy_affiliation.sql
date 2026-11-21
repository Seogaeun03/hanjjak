create table ssafy_affiliation_profile (
  account_id uuid primary key references account(id) on delete cascade,
  current_cohort integer check (current_cohort > 0),
  multiple_cohorts boolean not null default false,
  region varchar(32),
  region_reason varchar(32),
  verification_status varchar(32) not null,
  last_attempted_at timestamptz not null,
  last_verified_at timestamptz,
  scan_version bigint not null default 1 check (scan_version > 0),
  constraint ssafy_affiliation_profile_region_check check (
    region is null or region in ('SEOUL','SEOUL_MEISTER','DAEJEON','GWANGJU','GUMI','BUSAN_ULSAN_GYEONGNAM','UNDETERMINED')
  ),
  constraint ssafy_affiliation_profile_reason_check check (
    region_reason is null or region_reason in ('SINGLE_REGION','MULTIPLE_REGIONS','NO_REGION_GROUP','NO_SUPPORTED_GROUP')
  ),
  constraint ssafy_affiliation_profile_status_check check (
    verification_status in ('VERIFIED','NO_SUPPORTED_GROUP','STALE','UNVERIFIED')
  ),
  constraint ssafy_affiliation_profile_verified_at_check check (
    (verification_status = 'UNVERIFIED' and last_verified_at is null) or
    (verification_status <> 'UNVERIFIED' and last_verified_at is not null)
  )
);

create table ssafy_affiliation_evidence (
  account_id uuid not null references account(id) on delete cascade,
  evidence_type varchar(16) not null,
  evidence_value varchar(32) not null,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  primary key (account_id, evidence_type, evidence_value),
  constraint ssafy_affiliation_evidence_value_check check (
    (evidence_type = 'COHORT' and evidence_value ~ '^[1-9][0-9]*$') or
    (evidence_type = 'REGION' and evidence_value in ('SEOUL','SEOUL_MEISTER','DAEJEON','GWANGJU','GUMI','BUSAN_ULSAN_GYEONGNAM'))
  ),
  constraint ssafy_affiliation_evidence_time_check check (last_observed_at >= first_observed_at)
);

create index ssafy_affiliation_evidence_account_idx
  on ssafy_affiliation_evidence(account_id, evidence_type);
