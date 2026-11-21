-- Flyway must use PostgreSQL session advisory locks for this non-transactional migration.
create index concurrently outbox_chat_relay_idx
  on outbox_event(created_at, event_id)
  where event_type = 'CHAT_MESSAGE_CREATED';

create index concurrently outbox_pending_created_idx
  on outbox_event(created_at, event_id)
  where status = 'PENDING';

create index concurrently outbox_admin_status_recent_idx
  on outbox_event(status, created_at desc, event_id desc);
