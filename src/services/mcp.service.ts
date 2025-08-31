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
        
        this.mcpServerUrl = baseUrl.replace(/\/$/, '');
    }

    private async ensureSession(): Promise<string> {
        if (this.sessionId) return Promise.resolve(this.sessionId);
        if (this.initializationPromise) return this.initializationPromise;

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
                    headers: { 
                        'Content-Type': 'application/json', 
                        'Accept': 'application/json, text/event-stream'
                    },
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

    /**
     * Parsea una respuesta text/event-stream para extraer el objeto JSON completo.
     * El servidor MCP a veces envía el JSON dentro de un evento 'data:'.
     */
    private async parseStreamingResponse(response: Response): Promise<string> {
        const reader = response.body?.getReader();
        if (!reader) {
            // LOG: Si no hay un cuerpo de stream, leemos el texto de la forma tradicional.
            console.log('📜 [PARSER] No se detectó un stream. Leyendo como texto plano.');
            return await response.text();
        }

        const decoder = new TextDecoder();
        let fullText = '';
        
        console.log('🌊 [PARSER] Iniciando lectura del stream de datos...');
        let chunkIndex = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                console.log('✅ [PARSER] Fin del stream.');
                break;
            }
            
            // LOG: Mostramos cada trozo de datos (chunk) a medida que llega.
            const chunkText = decoder.decode(value, { stream: true });
            console.log(`📦 [PARSER] Chunk #${chunkIndex} recibido:`, chunkText);
            fullText += chunkText;
            chunkIndex++;
        }
        
        // LOG: Mostramos el texto completo ensamblado a partir de todos los chunks.
        console.log('📄 [PARSER] Texto completo ensamblado del stream:\n--- TEXTO COMPLETO ---\n' + fullText + '\n--- FIN TEXTO COMPLETO ---');

        const lines = fullText.split('\n');
        // LOG: Mostramos cómo se divide el texto completo en líneas individuales.
        console.log('✂️ [PARSER] Texto dividido en líneas:', lines);

        const dataLine = lines.find(line => line.startsWith('data:'));
        
        if (dataLine) {
            // LOG: Informamos que encontramos la línea 'data:' y cuál es.
            console.log(`🎯 [PARSER] Línea 'data:' encontrada: "${dataLine}"`);
            const jsonContent = dataLine.substring(5).trim();
            // LOG: Mostramos el contenido JSON extraído antes de devolverlo.
            console.log(`✨ [PARSER] Contenido JSON extraído para parsear: "${jsonContent}"`);
            return jsonContent;
        } else {
            // LOG: Si no hay línea 'data:', asumimos que todo el texto es el JSON.
            console.log('⚠️ [PARSER] No se encontró una línea específica "data:". Se usará el texto completo.');
            return fullText;
        }
    }

    public async executeTool(toolName: string, toolArgs: any): Promise<any> {
        try {
            const sessionId = await this.ensureSession();

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
                headers: { 
                    'Content-Type': 'application/json', 
                    'Accept': 'application/json, text/event-stream',
                    'mcp-session-id': sessionId 
                },
                body: JSON.stringify(mcpPayload),
            });
            
            // LOG: Mostramos el status y las cabeceras de la respuesta HTTP.
            console.log(`📥 [HTTP] Respuesta recibida con Status: ${response.status} ${response.statusText}`);
            console.log('[HTTP] Cabeceras de la respuesta:', Object.fromEntries(response.headers.entries()));

            const responseText = await this.parseStreamingResponse(response);

            if (!response.ok) {
                try {
                    const errorJson = JSON.parse(responseText);
                    if (errorJson.error) {
                        throw new Error(`Error reportado por el servidor MCP: ${errorJson.error.message}`);
                    }
                    throw new Error(`El servidor de base de datos respondió con un error: ${response.status} - ${responseText}`);
                } catch (e) {
                    if (e instanceof Error) throw e;
                    throw new Error(`El servidor de base de datos respondió con un error: ${response.status} - ${responseText}`);
                }
            }
            
            // LOG: Mostramos el objeto JavaScript final después de un parseo exitoso.
            console.log('✔️ [JSON] Parseo exitoso. Objeto resultante:', JSON.parse(responseText));
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
            const errorMessage = error instanceof Error ? error.message : 'No se pudo comunicar con el servicio de base de datos.';
            return { error: errorMessage };
        }
    }
}

const mcpService = new MCPService();

export const executeSql = (payload: any) => {
    return mcpService.executeTool('run_query_json', payload);
};