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
        
        // Normalizamos la URL para que nunca tenga una barra al final.
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

            // Este payload, con argumentos planos, es el formato estándar
            // y coincide con la firma de la herramienta 'query_json' del servidor.
            const mcpPayload = {
                jsonrpc: "2.0",
                method: "tools/call",
                params: {
                    name: toolName,
                    arguments: toolArgs
                },
                id: randomUUID()
            };

            const endpoint = `${this.mcpServerUrl}/mcp`;
            console.log(`➡️  Enviando Payload a MCP en ${endpoint}:`);
            console.log(JSON.stringify(mcpPayload, null, 2));
            
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'mcp-session-id': sessionId },
                body: JSON.stringify(mcpPayload),
            });

            const responseText = await response.text();
            if (!response.ok) {
                // Intentamos parsear el error incluso si el status no es 200
                try {
                    const errorJson = JSON.parse(responseText);
                    if (errorJson.error) {
                        throw new Error(`Error reportado por el servidor MCP: ${errorJson.error.message}`);
                    }
                } catch (e) {
                    // Si no es JSON, lanzamos el error de texto plano
                    throw new Error(`El servidor de base de datos respondió con un error: ${response.status} - ${responseText}`);
                }
            }
            
            const result: JsonRpcResponse = JSON.parse(responseText);
            if (result.error) {
                throw new Error(`Error reportado por el servidor MCP: ${result.error.message}`);
            }

            console.log('⬅️  Respuesta recibida de MCP.');
            return result.result;

        } catch (error) {
            console.error('❌ Fallo la comunicación con el servicio MCP:', error);
            this.sessionId = null;
            this.initializationPromise = null;
            return { error: 'No se pudo comunicar con el servicio de base de datos.' };
        }
    }
}

const mcpService = new MCPService();

// --- ¡EL CAMBIO DEFINITIVO! ---
// Usamos 'query_json' porque su firma (sql: str, row_limit: int) coincide
// con el payload plano que le estamos enviando y con los ejemplos de los SDK oficiales.
export const executeSql = (payload: any) => {
    return mcpService.executeTool('query_json', payload);
};