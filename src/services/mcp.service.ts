import { MCPClient } from 'mcp-client';
import { env } from '../config/environment';

export interface SessionState { /* ... */ }

const client = new MCPClient({
  name: "fp-agent-whatsapp-bot",
  version: "1.0.0",
});

let connectionPromise: Promise<void> | null = null;

async function ensureConnection() {
    if (!connectionPromise) {
        console.log('🤝 Conectando al servidor MCP usando mcp-client...');
        const serverUrl = env.mcpServerUrl.replace(/\/$/, '');
        connectionPromise = client.connect({
            type: 'sse',
            url: `${serverUrl}/sse`
        });
        await connectionPromise;
        console.log('✅ Conexión con el servidor MCP establecida con éxito.');
    }
    return connectionPromise;
}

class MCPService {
    public async executeTool(toolName: string, toolArgs: any): Promise<any> {
        try {
            await ensureConnection();
            console.log(`➡️  Enviando la herramienta '${toolName}' usando mcp-client...`);
            
            const result = await client.callTool({
                name: toolName,
                arguments: toolArgs,
            });
            
            console.log('⬅️  Respuesta de la herramienta recibida con éxito.');
            
            // "Desempaquetamos" el resultado para dárselo limpio al flujo principal.
            const content = result.structuredContent as any;
            
            if (content && content.status === 'success' && content.data !== undefined) {
                return content.data; // Devolvemos solo el array de datos
            } else if (content && content.error) {
                return { error: content.error };
            }

            return content; // Fallback

        } catch (error) {
            console.error('❌ Fallo durante la ejecución de la herramienta con mcp-client:', error);
            connectionPromise = null; 
            const errorMessage = error instanceof Error ? error.message : 'Error desconocido.';
            return { error: errorMessage };
        }
    }
}

const mcpService = new MCPService();

export const executeSql = (payload: any, state: SessionState) => {
    return mcpService.executeTool('run_query_json', payload);
};