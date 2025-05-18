import { drizzle } from 'drizzle-orm/postgres-js';
import 'dotenv/config';

const db = drizzle({connection:process.env.DB_URL!,casing: 'snake_case'});