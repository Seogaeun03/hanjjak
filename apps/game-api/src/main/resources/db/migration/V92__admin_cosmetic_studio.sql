create table admin_cosmetic_studio_set (
  set_id uuid primary key,
  name varchar(120) not null,
  concept_media_type varchar(32) not null,
  concept_data bytea not null,
  concept_render_data bytea not null,
  status varchar(16) not null check (status in ('queued','running','cancelling','cancelled','completed','failed')),
  completed_frames integer not null default 0 check (completed_frames between 0 and 102),
  total_frames integer not null default 102 check (total_frames = 102),
  job_cursor integer not null default 0 check (job_cursor between 0 and 102),
  current_slot varchar(16),
  current_motion varchar(16),
  error text,
  lease_token uuid,
  lease_until timestamptz,
  created_by uuid references admin_operator(operator_id) on delete set null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check (completed_frames = job_cursor),
  check ((lease_token is null) = (lease_until is null)),
  check ((status in ('running','cancelling')) or lease_token is null)
);

create index admin_cosmetic_studio_set_list_idx
  on admin_cosmetic_studio_set(created_at desc, set_id desc);

create index admin_cosmetic_studio_set_job_idx
  on admin_cosmetic_studio_set(status, lease_until, created_at, set_id)
  where status in ('queued','running','cancelling');

create table admin_cosmetic_studio_frame (
  frame_id varchar(48) not null,
  set_id uuid not null references admin_cosmetic_studio_set(set_id) on delete cascade,
  slot varchar(16) not null check (slot in ('HEAD','TOP','BOTTOM','GLOVES','SHOES','CAPE')),
  motion varchar(16) not null check (motion in ('rest','run','strike1','strike2','death')),
  frame integer not null check (frame between 1 and 4),
  png_data bytea not null,
  review varchar(16) not null default 'pending' check (review in ('pending','approved','rejected')),
  revision integer not null default 0 check (revision >= 0),
  width integer not null check (width = 384),
  height integer not null check (height = 384),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (set_id, frame_id),
  unique (set_id, slot, motion, frame),
  check (frame <= case when motion = 'death' then 1 else 4 end)
);

create index admin_cosmetic_studio_frame_list_idx
  on admin_cosmetic_studio_frame(set_id, slot, motion, frame);
