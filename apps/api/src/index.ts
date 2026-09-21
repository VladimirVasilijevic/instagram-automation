import { createRuntime } from './runtime.js';

// Initialize once per function instance so requests share the database connection.
const runtime = createRuntime();

/** Hono application served by Vercel without a local Node.js listener. */
export default runtime.app;
