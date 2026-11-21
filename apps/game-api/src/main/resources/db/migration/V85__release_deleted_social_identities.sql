delete from social_identity identity
using account
where identity.account_id = account.id
  and account.deleted_at is not null;
