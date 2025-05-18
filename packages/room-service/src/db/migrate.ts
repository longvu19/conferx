import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const db = drizzle({ connection: process.env.DB_URL!, casing: 'snake_case' });

const main = async () => {
  try {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Error during migrations:', error);
    process.exit(1);
  }
}

main()