// src/services/mcp.service.ts

import { env } from '../config/environment';
import { randomUUID } from 'crypto';

/**
 * Representa una respuesta JSON-RPC estándar.
 */
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
        this.mcpServerUrl = env.mcpServerUrl.startsWith('http')
            ? env.mcpServerUrl
            : `https://${env.mcpServerUrl}`;
    }

    /**
     * Asegura que tenemos un ID de sesión válido, inicializándolo si es necesario.
     */
    private ensureSession(): Promise<string> {
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
            
            const response = await fetch(`${this.mcpServerUrl}mcp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/event-stream',
                    'mcp-session-id': sessionId
                },
                body: JSON.stringify(mcpPayload),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`El servidor de base de datos respondió con un error: ${response.status} - ${errorText}`);
            }
            
            // --- ¡CORRECCIÓN FINAL Y DEFINITIVA! ---
            // Leemos la respuesta como TEXTO, ya que es un text/event-stream.
            const responseText = await response.text();
            
            // Buscamos la línea que contiene los datos JSON.
            const dataLine = responseText.split('\n').find(line => line.startsWith('data: '));
            
            if (!dataLine) {
                throw new Error('La respuesta del servidor no contenía un evento de datos JSON válido.');
            }

            // Extraemos y parseamos el JSON de la línea de datos.
            const jsonString = dataLine.substring(5).trim(); // Quitamos "data: " y espacios
            const result: JsonRpcResponse = JSON.parse(jsonString);
            // --- FIN DE LA CORRECCIÓN ---

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

// Creamos una única instancia para que la sesión se reutilice a través de toda la aplicación.
const mcpService = new MCPService();

// Exportamos la función que usará nuestro flujo principal.
export const executeSql = (query: string | string[]) => mcpService.executeSql(query);