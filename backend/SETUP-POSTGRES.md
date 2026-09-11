# Running the backend on Postgres

The database layer moved from MongoDB/Mongoose to Postgres (Drizzle ORM).
Nothing about the API, the frontend or the ClinWell integration changed —
only where the data is stored.

## 1. Get a Postgres to point at

**Local (simplest for development)**

    brew install postgresql@16
    brew services start postgresql@16
    createdb tls

Your connection string is then:

    postgresql://$(whoami)@localhost:5432/tls

**Or a free cloud database** — Neon (https://neon.tech) or Supabase
(https://supabase.com). Create a project in a London/EU region and copy
the connection string they give you.

## 2. Point the backend at it

    cd backend
    cp .env.example .env      # if you don't have a .env yet

Then edit `.env` and set:

    DATABASE_URL=postgresql://YOURNAME@localhost:5432/tls
    AUTH_SECRET=<paste the output of: openssl rand -base64 48>

`AUTH_SECRET` is not optional any more in practice — without it every
restart logs everyone out.

## 3. Create the tables and load the starter data

    npm install          # only needed once
    npm run db:migrate   # creates all 24 tables
    npm run seed         # taxonomy, demo directory, admin account

The seed prints the admin login it created (admin@tls.test / demo1234 by
default). Change that password, or set SEED_ADMIN_EMAIL and
SEED_ADMIN_PASSWORD in `.env` before seeding.

`npm run seed` refuses to run against a database that already has real
sign-ups in it. Pass `--force` only if you genuinely want to wipe them.

## 4. Run it

    npm run dev          # backend on :4000
    cd ../frontend && npm run dev    # frontend on :5173

`GET /api/health` reports `{"mode":"postgres"}` when it is connected,
and `{"mode":"demo"}` when DATABASE_URL is empty.

## Demo mode still works

Leave `DATABASE_URL` blank and the whole site runs off `src/data/mock.js`
exactly as before — useful for a quick look without a database running.

## Changing the schema later

    # edit src/db/schema.js, then:
    npm run db:generate    # writes a new .sql file into drizzle/
    npm run db:migrate     # applies it

The migrations are plain SQL in `drizzle/` — readable, reviewable, and
safe to hand to another developer.

## What is where

    src/db/schema.js    every table, column and index, with comments
    src/db/repos.js     the queries the controllers use
    src/db/client.js    the connection pool
    src/db/migrate.js   applies the migrations
    drizzle/            generated .sql migrations
