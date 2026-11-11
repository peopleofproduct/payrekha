# @payrekha/store-postgres

Postgres state store for [PayRekha](https://github.com/peopleofproduct/payrekha). It keeps the full firewall snapshot (hashed refs only) in one JSONB row per deployment. Every save is a compare-and-set on a version counter, so a second writer gets `StaleStateError` instead of silently overwriting a HIGH_ALERT.

```ts
import { Payrekha } from '@payrekha/core';
import { PostgresStateStore } from '@payrekha/store-postgres';

const store = new PostgresStateStore({ connectionString: process.env.DATABASE_URL, name: 'payouts-prod' });
await store.load(fw); // false on first run; throws if the DB is unreachable
setInterval(() => store.save(fw).catch(failClosed), 5_000);
```

The gateway uses it when `PAYREKHA_STATE_PG_URL` is set. Run one active writer per `name`; a standby can `load` on promotion.

Apache-2.0.
