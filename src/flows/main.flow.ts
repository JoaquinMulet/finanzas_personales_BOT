// src/flows/main.flow.ts

import { addKeyword, EVENTS } from '@builderbot/bot';
import { env } from '../config/environment';
import { getAIResponse, AIResponse } from '../services/openrouter.service';
import { executeSql } from '../services/mcp.service';
import { ChatCompletionMessageParam } from 'openai/resources';

const CONVERSATION_EXPIRATION_MS = 30 * 60 * 1000;
const MAX_RETRY_ATTEMPTS = 2;

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
        let attempts = state.get('attempts') || 0;

        if (now - lastInteraction > CONVERSATION_EXPIRATION_MS) {
            history = [];
            attempts = 0;
        }

        console.log(`💬 Procesando mensaje: "${ctx.body}"`);
        let aiResponse: AIResponse = await getAIResponse(history, ctx.body);
        let finalResponse = 'Lo siento, ocurrió un error inesperado y no pude procesar tu solicitud.';

        // --- BUCLE DE AUTOCORRECCIÓN ---
        while (
            aiResponse.type === 'tool' &&
            aiResponse.data.tool === 'run_query_json' &&
            attempts < MAX_RETRY_ATTEMPTS
        ) {
            console.log(`🤖 La IA decidió usar la herramienta: 'run_query_json' (Intento #${attempts + 1})`);
            console.log(`📋 Con el siguiente payload:`, JSON.stringify(aiResponse.data.payload, null, 2));

            const toolResult = await executeSql(aiResponse.data.payload);

            if (toolResult && toolResult.error) {
                console.log(`❌ La herramienta falló. Devolviendo error a la IA para corrección.`);
                attempts++;
                
                const contextForCorrection = `La herramienta 'run_query_json' falló.
                - Tu consulta fue: ${JSON.stringify(aiResponse.data.payload.input.sql)}
                - El error devuelto por la base de datos fue: "${toolResult.error}"
                - Por favor, analiza el error, corrige tu consulta SQL y llama a la herramienta 'run_query_json' de nuevo. NO te disculpes.`;
                
                aiResponse = await getAIResponse(
                    [...history, { role: 'user', content: ctx.body }],
                    contextForCorrection
                );
                // El bucle continuará con la nueva respuesta de la IA
            } else {
                console.log('✅ La herramienta tuvo éxito. Pidiendo a la IA que interprete el resultado.');
                const contextForInterpretation = `El sistema ejecutó la consulta SQL con éxito.
                - Tu consulta fue: ${JSON.stringify(aiResponse.data.payload.input.sql)}
                - El resultado fue: ${JSON.stringify(toolResult)}.
                Ahora, genera una respuesta final y amigable para el usuario usando 'respond_to_user'.`;
                
                aiResponse = await getAIResponse( // Sobrescribimos aiResponse con la interpretación final
                    [...history, { role: 'user', content: ctx.body }],
                    contextForInterpretation
                );
                break; // Salimos del bucle porque la acción fue exitosa
            }
        }

        // --- MANEJO DE LA RESPUESTA FINAL ---
        if (aiResponse.type === 'tool' && aiResponse.data.tool === 'respond_to_user') {
            finalResponse = aiResponse.data.payload.response;
        } else if (aiResponse.type === 'text') {
            finalResponse = aiResponse.data;
        } else if (attempts >= MAX_RETRY_ATTEMPTS) {
            finalResponse = "Lo siento, he intentado corregir un error varias veces sin éxito. Por favor, revisa la solicitud o contacta al administrador."
        }
        
        console.log(`➡️  Enviando respuesta final: "${finalResponse}"`);
        const newHistory: ChatCompletionMessageParam[] = [
            ...history,
            { role: 'user', content: ctx.body },
            { role: 'assistant', content: finalResponse }
        ];

        await state.update({ history: newHistory, lastInteraction: now, attempts: 0 }); // Reiniciamos intentos al final
        await flowDynamic(finalResponse);
    });