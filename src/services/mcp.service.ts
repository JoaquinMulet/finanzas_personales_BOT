// src/services/mcp.service.ts

import { ChildProcess } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { env } from '../config/environment';

class MCPService {
    private client: Client | null = null;
    private initializationPromise: Promise<void> | null = null;

    private initialize(): Promise<void> {
        if (this.initializationPromise) {
            return this.initializationPromise;
        }

        this.initializationPromise = new Promise((resolve, reject) => {
            (async () => {
                try {
                    console.log('🚀 Lanzando el proceso del servidor postgres-mcp (Crystal DBA)...');

                    const command = 'pipx';
                    const args = [
                        'run',
                        'postgres-mcp', // El comando a ejecutar
                        '--access-mode=unrestricted',
                        process.env.DATABASE_URL!
                    ];

                    const transport = new StdioClientTransport({
                        command: command,
                        args: args,
                    });

                    this.client = new Client({ name: "fp-agent-client", version: "1.0.0" });
                    await this.client.connect(transport);

                    const { tools } = await this.client.listTools();
                    console.log(`✅ Conectado al servidor MCP local con herramientas: ${tools.map(t => t.name).join(', ')}`);

                    this.client.onclose = () => {
                        console.log(`MCP server process exited`);
                        this.client = null;
                        this.initializationPromise = null;
                    };

                    resolve();

                } catch (error) {
                    console.error('❌ Fallo catastrófico al iniciar la sesión MCP:', error);
                    this.initializationPromise = null;
                    reject(error);
                }
            })();
        });
        return this.initializationPromise;
    }

    public async executeSql(query: string | string[]): Promise<any> {
        if (!this.client) {
            await this.initialize();
        }
        if (!this.client) {
            throw new Error('El cliente MCP no se pudo inicializar.');
        }

        try {
            console.log(`➡️  Enviando SQL a MCP (proceso local)...`);
            const result = await this.client.callTool({
                name: 'execute_sql',
                arguments: { query }
            });
            
            console.log('⬅️  Respuesta recibida de MCP.');
            if (result.content && result.content[0].type === 'text') {
                try {
                    return JSON.parse(result.content[0].text);
                } catch {
                    return result.content[0].text;
                }
            }
            return result.content;
        } catch (error) {
            console.error('❌ Error al ejecutar la herramienta SQL en MCP:', error);
            return { error: 'Hubo un error al ejecutar la consulta SQL.' };
        }
    }
}

const mcpService = new MCPService();
export const executeSql = (query: string | string[]) => mcpService.executeSql(query);