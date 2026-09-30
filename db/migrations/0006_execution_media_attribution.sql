alter table app_private.executions
  add column media_id text,
  add constraint executions_media_id_not_blank
    check (media_id is null or btrim(media_id) <> '');

create index executions_media_created_at_index
on app_private.executions (media_id, created_at desc)
where media_id is not null;
