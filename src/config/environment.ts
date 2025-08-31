import 'dotenv/config'

export const env = {
    port: process.env.PORT ?? 3008,
    myPhoneNumber: process.env.MY_PHONE_NUMBER ?? '',
    openRouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
    mcpServerUrl: process.env.MCP_SERVER_URL ?? '',
    memoryServiceUrl: process.env.MEMORY_SERVICE_URL ?? '',
    db: {
        host: process.env.POSTGRES_DB_HOST ?? 'localhost',
        user: process.env.POSTGRES_DB_USER ?? 'postgres',
        database: process.env.POSTGRES_DB_NAME ?? 'bbuilderbot',
        password: process.env.POSTGRES_DB_PASSWORD ?? 'admin',
        port: parseInt(process.env.POSTGRES_DB_PORT ?? '5432'),
    },
};

// Simple validation
if (!env.myPhoneNumber || !env.openRouterApiKey) {
    throw new Error('Missing critical environment variables: MY_PHONE_NUMBER or OPENROUTER_API_KEY');
}