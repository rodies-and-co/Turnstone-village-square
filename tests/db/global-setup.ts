import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { DB, adminUrl, dbUrl, type DbName } from "./db";

const root = path.resolve(__dirname, "../..");

async function rebuild(
  name: DbName,
  migrationsDir: string,
  extraFiles: string[],
) {
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();

  const db = new Client({ connectionString: dbUrl(name) });
  await db.connect();
  try {
    await db.query(
      readFileSync(path.join(__dirname, "supabase-auth-stub.sql"), "utf8"),
    );
    for (const file of readdirSync(migrationsDir).sort()) {
      await db.query(readFileSync(path.join(migrationsDir, file), "utf8"));
    }
    for (const file of extraFiles) {
      await db.query(readFileSync(file, "utf8"));
    }
  } finally {
    await db.end();
  }
}

// Builds fresh test databases from the real migrations, then adds the
// fictional test users and records.
export default async function setup() {
  await rebuild(DB.hub, path.join(root, "supabase/hub/migrations"), [
    path.join(__dirname, "hub-test-data.sql"),
  ]);
  await rebuild(DB.familyA, path.join(root, "supabase/family/migrations"), [
    path.join(__dirname, "family-a-test-data.sql"),
  ]);
  await rebuild(DB.familyB, path.join(root, "supabase/family/migrations"), [
    path.join(__dirname, "family-b-test-data.sql"),
  ]);
}
