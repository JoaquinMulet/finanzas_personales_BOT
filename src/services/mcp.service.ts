// src/services/mcp.service.ts

import { env } from '../config/environment';
import { randomUUID } from 'crypto';

interface JsonRpcResponse {
  jsonrpc: string;
  id: string;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

class MCPService {
    private sessionId: string | null = null;
    private initializationPromise: Promise<string> | null = null;
    private mcpServerUrl: string;

    constructor() {
        if (!env.mcpServerUrl) {
            throw new Error('La URL del servidor MCP no está configurada.');
        }
        const baseUrl = env.mcpServerUrl.startsWith('http')
            ? env.mcpServerUrl
            : `https://${env.mcpServerUrl}`;
        
        // CORRECCIÓN 1: Normalizamos la URL para que nunca tenga una barra al final.
        // Esto evita errores de doble barra (//) sin importar cómo se configure la variable de entorno.
        this.mcpServerUrl = baseUrl.replace(/\/$/, '');
    }

    private async ensureSession(): Promise<string> {
        if (this.sessionId) {
            return Promise.resolve(this.sessionId);
        }
        if (this.initializationPromise) {
            return this.initializationPromise;
        }
        this.initializationPromise = new Promise(async (resolve, reject) => {
            try {
                console.log('🤝 Iniciando nueva sesión MCP...');
                const initPayload = {
                    jsonrpc: "2.0", method: "initialize",
                    params: { capabilities: { tools: {}, resources: {} }, client: { name: "fp-agent-whatsapp-bot", version: "1.0.0" } },
                    id: randomUUID()
                };
                
                // Ahora añadimos /mcp de forma consistente, sabiendo que la base no tiene la barra.
                const response = await fetch(`${this.mcpServerUrl}/mcp`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
                    body: JSON.stringify(initPayload),
                });

                if (!response.ok) { throw new Error(`Fallo en la inicialización: ${response.status} ${await response.text()}`); }
                
                const sessionId = response.headers.get('mcp-session-id');
                if (!sessionId) { throw new Error('El servidor no devolvió un mcp-session-id en las cabeceras.'); }
                
                this.sessionId = sessionId;
                console.log(`✅ Sesión MCP establecida con ID: ${sessionId.substring(0, 8)}...`);
                resolve(sessionId);
            } catch (error) {
                this.initializationPromise = null;
                reject(error);
            }
        });
        return this.initializationPromise;
    }

    public async executeTool(toolName: string, toolArgs: any): Promise<any> {
        try {
            const sessionId = await this.ensureSession();

            // --- ¡CORRECCIÓN FINAL! ---
            // El framework del servidor (FastMCP) espera los campos del modelo Pydantic
            // (como 'sql' y 'row_limit') directamente en el objeto 'arguments'.
            // NO debemos envolverlos en una clave "input".
            const mcpPayload = {
                jsonrpc: "2.0",
                method: "tools/call",
                params: {
                    name: toolName,
                    arguments: toolArgs // Pasamos el objeto {sql: "..."} directamente.
                },
                id: randomUUID()
            };
            // --- FIN DE LA CORRECCIÓN ---

            const endpoint = `${this.mcpServerUrl}/mcp`;
            console.log(`➡️  Enviando Payload a MCP en ${endpoint}:`);
            console.log(JSON.stringify(mcpPayload, null, 2));
            
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'mcp-session-id': sessionId },
                body: JSON.stringify(mcpPayload),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`El servidor de base de datos respondió con un error: ${response.status} - ${errorText}`);
            }
            
            const responseText = await response.text();
            
            // Manejo robusto de la respuesta (stream vs. non-stream)
            const dataLine = responseText.split('\n').find(line => line.startsWith('data: '));
            if (!dataLine) {
                if (responseText.includes('"result":') || responseText.includes('"error":')) { 
                    const result: JsonRpcResponse = JSON.parse(responseText);
                    if (result.error) throw new Error(`Error reportado por el servidor MCP: ${result.error.message}`);
                    console.log('⬅️  Respuesta (no-stream) recibida de MCP.');
                    // Para run_query_json, el resultado está en `result`, no en `structuredContent`
                    return result.result; 
                }
                throw new Error('La respuesta del servidor no contenía un evento de datos JSON válido.');
            }

            const jsonString = dataLine.substring(5).trim();
            const result: JsonRpcResponse = JSON.parse(jsonString);

            if (result.error) {
                 throw new Error(`Error reportado por el servidor MCP: ${result.error.message}`);
            }
            
            console.log('⬅️  Respuesta (stream) recibida de MCP.');
             // Para run_query_json, el resultado está en `result.structuredContent`
            return result.result?.structuredContent;

        } catch (error) {
            console.error('❌ Fallo la comunicación con el servicio MCP:', error);
            // Resetea el estado para permitir un reintento de conexión
            this.sessionId = null;
            this.initializationPromise = null;
            return { error: 'No se pudo comunicar con el servicio de base de datos.' };
        }
    }
}

const mcpService = new MCPService();
export const executeSql = (payload: any) => {
    return mcpService.executeTool('run_query_json', payload);
};