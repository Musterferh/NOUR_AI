// Compatibility entry point. Both local SQLite and Turso use versioned migrations.
await import('./migrate.mjs');
