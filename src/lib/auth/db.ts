import { neon } from '@neondatabase/serverless';

export const authDb = neon(process.env.META_DB_URL!);
