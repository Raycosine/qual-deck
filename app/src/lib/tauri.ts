import { select } from './db';

export async function isAppInitialized(): Promise<boolean> {
  try {
    const libraries = await select<any>('SELECT id FROM source_libraries LIMIT 1');
    return libraries.length > 0;
  } catch (err) {
    console.error('Failed to check app initialization:', err);
    return false;
  }
}
