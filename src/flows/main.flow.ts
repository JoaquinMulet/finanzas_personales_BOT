// src/flows/main.flow.ts

import { addKeyword, EVENTS } from '@builderbot/bot';
import { env } from '../config/environment';
import { getAIResponse } from '../services/openrouter.service';
import { executeSql } from '../services/mcp.service';
import { ChatCompletionMessageParam } from 'openai/resources';

const CONVERSATION_EXPIRATION_MS = 30 * 60 * 1000; // 30 minutos

export const mainFlow = addKeyword(EVENTS.WELCOME)
    .addAction(async (ctx, { endFlow }) => {
        if (ctx.from !== env.myPhoneNumber) {
            console.log(`🚫 Mensaje ignorado de un número no autorizado: ${ctx.from}`);
            return endFlow();
        }
    })
    .addAction(async (ctx, { state, flowDynamic }) => {
        const lastInteraction = state.get('lastInteraction') || 0;
        const now = Date.now();
        let history = state.get<ChatCompletionMessageParam[]>('history') || [];

        if (now - lastInteraction > CONVERSATION_EXPIRATION_MS) {
            console.log('⏳ La conversación expiró. Reiniciando el historial.');
            history = [];
        }

        console.log(`💬 Procesando mensaje: "${ctx.body}"`);
        const aiResponse = await getAIResponse(history, ctx.body);

        let finalResponse = 'Lo siento, ocurrió un error inesperado y no pude procesar tu solicitud.';

        if (aiResponse.type === 'tool') {
            const { tool, payload } = aiResponse.data;
            console.log(`🤖 La IA decidió usar la herramienta: '${tool}'`);
            console.log(`📋 Con el siguiente payload:`, JSON.stringify(payload, null, 2));

            switch (tool) {
                // --- ¡CORRECCIÓN FINAL! ---
                // El nombre de la herramienta que la IA usará es 'run_query_json'.
                case 'run_query_json': {
                    // El payload que nos da la IA es: { sql: "...", ... }
                    // Nuestra función executeSql está diseñada para recibir este objeto.
                    const toolResult = await executeSql(payload); 
                    
                    console.log('🧠 Pidiendo a la IA que interprete el resultado de la herramienta...');
                    
                    const contextForInterpretation = `El sistema ejecutó la consulta SQL que pediste.
                    - Tu consulta fue: ${JSON.stringify(payload.sql)}
                    - El resultado fue: ${JSON.stringify(toolResult)}.
                    Ahora, por favor, genera una respuesta final y amigable para el usuario en el formato JSON de 'respond_to_user'.`;
                    
                    const interpretation = await getAIResponse(
                        [...history, { role: 'user', content: ctx.body }],
                        contextForInterpretation
                    );
                    
                    if (interpretation.type === 'tool' && interpretation.data.tool === 'respond_to_user') {
                        finalResponse = interpretation.data.payload.response;
                    } else {
                        console.log('⚠️ La IA no pudo interpretar el resultado, usando respuesta genérica.');
                        finalResponse = "Acción completada.";
                    }
                    break;
                }
                // --- FIN DE CORRECCIÓN ---
                
                case 'respond_to_user':
                    finalResponse = payload.response;
                    break;

                default:
                    console.log(`⚠️ La IA intentó usar una herramienta desconocida: '${tool}'`);
                    finalResponse = "Lo siento, intenté hacer algo que no está permitido.";
            }
        } else if (aiResponse.type === 'text') {
            finalResponse = aiResponse.data;
        }
        
        console.log(`➡️  Enviando respuesta final: "${finalResponse}"`);
        const newHistory: ChatCompletionMessageParam[] = [
            ...history,
            { role: 'user', content: ctx.body },
            { role: 'assistant', content: finalResponse }
        ];

        await state.update({ history: newHistory, lastInteraction: now });
        await flowDynamic(finalResponse);
    });