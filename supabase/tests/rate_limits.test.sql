-- Tests for take_rate_limit(). Self-contained; rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(5);

select is(take_rate_limit('test:a', 60, 2), true, 'first request allowed');
select is(take_rate_limit('test:a', 60, 2), true, 'second allowed');
select is(take_rate_limit('test:a', 60, 2), false, 'third over the limit');
select is(take_rate_limit('test:b', 60, 2), true, 'another key has its own count');

-- A row from an earlier window is cleaned up on the next request.
insert into rate_limit_hits (key, window_start, hits) values ('test:c', now() - interval '1 hour', 99);
select take_rate_limit('test:c', 60, 2);
select is((select count(*)::int from rate_limit_hits where key = 'test:c'), 1, 'old windows are deleted');

select * from finish();
rollback;
