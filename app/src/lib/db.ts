import Database from '@tauri-apps/plugin-sql';

let db: Database | null = null;

export async function getDb() {
  if (db) return db;
  db = await Database.load('sqlite:mathdeck.db');
  return db;
}

export async function execute(query: string, values: any[] = []) {
  const database = await getDb();
  return await database.execute(query, values);
}

export async function select<T>(query: string, values: any[] = []): Promise<T[]> {
  const database = await getDb();
  return await database.select<T[]>(query, values);
}
