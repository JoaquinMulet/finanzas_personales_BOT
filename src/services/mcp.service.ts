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
        this.mcpServerUrl = env.mcpServerUrl.startsWith('http')
            ? env.mcpServerUrl
            : `https://${env.mcpServerUrl}`;
    }

    private async ensureSession(): Promise<string> {
        if (this.sessionId) {
            return Promise.resolve(this.sessionId);
        }
        if (this.initializationPromise) {
            return this.initializationPromise;
        }
        this.initializationPromise = new Promise(async (resolve, reject) => {
            // ... (lógica de inicialización sin cambios, es perfecta) ...
            try {
                console.log('🤝 Iniciando nueva sesión MCP...');
                const initPayload = {
                    jsonrpc: "2.0", method: "initialize",
                    params: { capabilities: { tools: {}, resources: {} }, client: { name: "fp-agent-whatsapp-bot", version: "1.0.0" } },
                    id: randomUUID()
                };
                const response = await fetch(`${this.mcpServerUrl}mcp`, {
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

            // --- ¡AQUÍ ESTÁ LA CORRECCIÓN FINAL Y DEFINITIVA! ---
            // El servidor espera que los argumentos de la herramienta estén
            // envueltos en un objeto "input".
            const mcpPayload = {
                jsonrpc: "2.0",
                method: "tools/call",
                params: {
                    name: toolName,
                    arguments: {
                        input: toolArgs // Envolvemos los argumentos en la clave "input"
                    }
                },
                id: randomUUID()
            };
            // --- FIN DE LA CORRECCIÓN ---

            console.log(`➡️  Enviando Payload a MCP en ${this.mcpServerUrl}mcp:`);
            console.log(JSON.stringify(mcpPayload, null, 2));
            
            const response = await fetch(`${this.mcpServerUrl}mcp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'mcp-session-id': sessionId },
                body: JSON.stringify(mcpPayload),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`El servidor de base de datos respondió con un error: ${response.status} - ${errorText}`);
            }
            
            const responseText = await response.text();
            const dataLine = responseText.split('\n').find(line => line.startsWith('data: '));
            if (!dataLine) {
                if (responseText.includes('"result":')) { // Manejar respuestas no-stream
                    const result: JsonRpcResponse = JSON.parse(responseText);
                    if (result.error) throw new Error(`Error reportado por el servidor MCP: ${result.error.message}`);
                    console.log('⬅️  Respuesta (no-stream) recibida de MCP.');
                    return result.result?.structuredContent;
                }
                throw new Error('La respuesta del servidor no contenía un evento de datos JSON válido.');
            }
            const jsonString = dataLine.substring(5).trim();
            const result: JsonRpcResponse = JSON.parse(jsonString);

            if (result.error) {
                 throw new Error(`Error reportado por el servidor MCP: ${result.error.message}`);
            }
            
            console.log('⬅️  Respuesta recibida de MCP.');
            return result.result?.structuredContent;

        } catch (error) {
            console.error('❌ Fallo la comunicación con el servicio MCP:', error);
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