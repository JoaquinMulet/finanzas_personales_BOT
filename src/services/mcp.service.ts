import { MCPClient } from 'mcp-client';
import { env } from '../config/environment';

export interface SessionState {
    get<T>(key: string): T;
    update(data: Record<string, any>): Promise<any>;
}

const client = new MCPClient({
  name: "fp-agent-whatsapp-bot",
  version: "1.0.0",
});

let connectionPromise: Promise<void> | null = null;

async function ensureConnection() {
    let isConnected = true;
    try {
        await client.ping();
    } catch (error) {
        isConnected = false;
    }

    if (!isConnected) {
        connectionPromise = null;
    }

    if (!connectionPromise) {
        console.log('🤝 Conectando al servidor MCP usando mcp-client...');
        const serverUrl = env.mcpServerUrl.replace(/\/$/, '');
        connectionPromise = client.connect({
            type: 'sse',
            url: `${serverUrl}/sse`
        });
        try {
            await connectionPromise;
            console.log('✅ Conexión con el servidor MCP establecida con éxito.');
        } catch (error) {
            connectionPromise = null;
            throw error;
        }
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
            
            // --- ¡CAMBIO CLAVE AQUÍ! ---
            // "Desempaquetamos" el resultado para dárselo limpio al flujo principal.
            const content = result.structuredContent as any;
            
            if (content && content.status === 'success' && content.data !== undefined) {
                // Si la consulta fue exitosa, devolvemos solo el array de datos.
                return content.data;
            } else if (content && content.error) {
                // Si el servidor devolvió un error de negocio, lo propagamos.
                return { error: content.error };
            }

            // Fallback por si la estructura no es la esperada.
            return content;

        } catch (error) {
            console.error('❌ Fallo durante la ejecución de la herramienta con mcp-client:', error);
            connectionPromise = null; 
            const errorMessage = error instanceof Error ? error.message : 'Error desconocido al ejecutar la herramienta.';
            return { error: errorMessage };
        }
    }
}

const mcpService = new MCPService();

export const executeSql = (payload: any, state: SessionState) => {
    return mcpService.executeTool('run_query_json', payload);
};