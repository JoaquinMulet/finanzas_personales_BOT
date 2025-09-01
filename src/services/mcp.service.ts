// src/services/mcp.service.ts (Versión con mcp-client)

import { MCPClient } from 'mcp-client';
import { env } from '../config/environment';

// La interfaz de estado ya no es necesaria para la lógica de sesión, 
// pero la mantenemos para que la firma de `executeSql` no cambie.
export interface SessionState {
    get<T>(key: string): T;
    update(data: Record<string, any>): Promise<any>;
}

// --- Implementación usando la librería mcp-client ---

// 1. Creamos una única instancia del cliente para toda la aplicación.
const client = new MCPClient({
  name: "fp-agent-whatsapp-bot",
  version: "1.0.0",
});

// 2. Variable para gestionar la promesa de conexión.
//    Esto asegura que solo intentamos conectar una vez.
let connectionPromise: Promise<void> | null = null;

/**
 * Asegura que el cliente MCP esté conectado al servidor.
 * Si ya hay una conexión, no hace nada. Si no, la establece.
 */
async function ensureConnection() {
    try {
        // Hacemos ping para ver si la conexión está activa.
        await client.ping();
    } catch (error) {
        // Si el ping falla, asumimos que no estamos conectados y reseteamos la promesa.
        console.log('Ping fallido, se forzará una nueva conexión.');
        connectionPromise = null;
    }

    if (!connectionPromise) {
        console.log('🤝 Conectando al servidor MCP usando mcp-client...');
        
        const serverUrl = env.mcpServerUrl.replace(/\/$/, '');
        
        // Usamos el tipo de conexión 'sse' que descubrimos durante la depuración.
        connectionPromise = client.connect({
            type: 'sse',
            url: `${serverUrl}/sse`
        });

        try {
            await connectionPromise;
            console.log('✅ Conexión con el servidor MCP establecida con éxito.');
        } catch (error) {
            // Si la conexión falla, reseteamos la promesa para permitir reintentos.
            connectionPromise = null;
            // Lanzamos el error para que sea capturado por el llamador.
            throw error;
        }
    }
    return connectionPromise;
}

class MCPService {
    public async executeTool(toolName: string, toolArgs: any): Promise<any> {
        try {
            // 1. Aseguramos que la conexión esté lista.
            await ensureConnection();
            
            console.log(`➡️  Enviando la herramienta '${toolName}' usando mcp-client...`);
            
            // 2. Llamamos a la herramienta. La librería maneja toda la complejidad
            //    del handshake, inicialización y seguimiento de peticiones.
            const result = await client.callTool({
                name: toolName,
                arguments: toolArgs,
            });
            
            console.log('⬅️  Respuesta de la herramienta recibida con éxito.');
            
            // 3. La librería ya parsea el resultado. Devolvemos el contenido estructurado.
            //    Esto contendrá el objeto JSON que tu servidor devuelve.
            return result.structuredContent;

        } catch (error) {
            console.error('❌ Fallo durante la ejecución de la herramienta con mcp-client:', error);
            
            // Si la conexión falla, es importante resetear la promesa para
            // que el siguiente intento de llamada a la herramienta cree una nueva conexión.
            connectionPromise = null; 
            
            const errorMessage = error instanceof Error ? error.message : 'Error desconocido al ejecutar la herramienta.';
            return { error: errorMessage };
        }
    }
}

// Creamos una instancia del servicio.
const mcpService = new MCPService();

// La función exportada se mantiene igual, proporcionando una interfaz limpia para el flujo.
export const executeSql = (payload: any, state: SessionState) => {
    // El 'state' ya no se usa aquí, pero lo mantenemos para no romper el contrato con main.flow.ts
    return mcpService.executeTool('run_query_json', payload);
};