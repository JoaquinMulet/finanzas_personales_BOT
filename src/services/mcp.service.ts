// src/services/mcp.service.ts

import { env } from '../config/environment';
import { randomUUID } from 'crypto';

interface JsonRpcError {
    code: number;
    message: string;
    data?: any;
}

interface JsonRpcResult {
    structuredContent: any;
}

interface JsonRpcResponse {
    jsonrpc: string;
    id: string;
    result?: JsonRpcResult;
    error?: JsonRpcError;
}

class MCPService {
    private sessionId: string | null = null;
    private initializationPromise: Promise<string> | null = null;
    private mcpServerUrl: string;

    constructor() {
        if (!env.mcpServerUrl) {
            throw new Error('La URL del servidor MCP no está configurada.');
        }
        this.mcpServerUrl = env.mcpServerUrl.startsWith('http')
            ? env.mcpServerUrl
            : `https://${env.mcpServerUrl}`;
    }

    /**
     * Asegura que tenemos un ID de sesión válido, inicializándolo si es necesario.
     */
    private async ensureSession(): Promise<string> {
        if (this.sessionId) {
            return this.sessionId;
        }

        // Si ya hay una promesa de inicialización en curso, la esperamos.
        if (this.initializationPromise) {
            return this.initializationPromise;
        }

        // Creamos una nueva promesa de inicialización.
        this.initializationPromise = new Promise(async (resolve, reject) => {
            try {
                console.log('🤝 Iniciando nueva sesión MCP...');
                
                const initPayload = {
                    jsonrpc: "2.0",
                    method: "initialize",
                    params: {
                        capabilities: { tools: {}, resources: {} },
                        client: { name: "fp-agent-whatsapp-bot", version: "1.0.0" }
                    },
                    id: randomUUID()
                };

                const response = await fetch(`${this.mcpServerUrl}mcp`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Accept': 'application/json, text/event-stream'
                    },
                    body: JSON.stringify(initPayload),
                });

                if (!response.ok) {
                    throw new Error(`Fallo en la inicialización: ${response.status} ${await response.text()}`);
                }

                const sessionId = response.headers.get('mcp-session-id');
                if (!sessionId) {
                    throw new Error('El servidor no devolvió un mcp-session-id en las cabeceras.');
                }

                this.sessionId = sessionId;
                console.log(`✅ Sesión MCP establecida con ID: ${sessionId.substring(0, 8)}...`);
                resolve(sessionId);

            } catch (error) {
                this.initializationPromise = null; // Permitir reintentos
                reject(error);
            }
        });

        return this.initializationPromise;
    }

    /**
     * Ejecuta una consulta SQL usando la sesión de MCP establecida.
     */
    public async executeSql(query: string | string[]): Promise<any> {
        try {
            const sessionId = await this.ensureSession();

            const mcpPayload = {
                jsonrpc: "2.0",
                method: "run_query_json",
                params: {
                    input: {
                        sql: Array.isArray(query) ? query.join('; ') : query,
                        row_limit: 1000
                    }
                },
                id: randomUUID()
            };

            console.log(`➡️  Enviando llamada a herramienta MCP: ${mcpPayload.method}`);
            
            const response = await fetch(`${this.mcpServerUrl}/mcp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/event-stream',
                    'mcp-session-id': sessionId // ¡AQUÍ ESTÁ LA MAGIA!
                },
                body: JSON.stringify(mcpPayload),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`El servidor de base de datos respondió con un error: ${response.status} - ${errorText}`);
            }
            
            const result: JsonRpcResponse = await response.json();

            if (result.error) {
                 throw new Error(`Error reportado por el servidor MCP: ${result.error.message}`);
            }
            
            console.log('⬅️  Respuesta recibida de MCP.');
            return result.result?.structuredContent;

        } catch (error) {
            console.error('❌ Fallo la comunicación con el servicio MCP:', error);
            // Si la sesión falla, la reseteamos para que el próximo intento sea fresco.
            this.sessionId = null;
            this.initializationPromise = null;
            return { error: 'No se pudo comunicar con el servicio de base de datos.' };
        }
    }
}

// Creamos una única instancia para que la sesión se reutilice
const mcpService = new MCPService();
export const executeSql = (query: string | string[]) => mcpService.executeSql(query);