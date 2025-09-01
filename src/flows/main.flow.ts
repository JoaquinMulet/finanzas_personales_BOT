import { addKeyword, EVENTS } from '@builderbot/bot';
import { env } from '../config/environment';
import { getAIResponse, AIResponse } from '../services/openrouter.service';
import { executeSql, SessionState } from '../services/mcp.service';
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
        const lastInteraction = state.get<number>('lastInteraction') || 0;
        const now = Date.now();
        let history = state.get<ChatCompletionMessageParam[]>('history') || [];
        let attempts = 0;

        if (now - lastInteraction > CONVERSATION_EXPIRATION_MS) {
            console.log('⌛️ La conversación ha expirado. Reseteando el historial.');
            history = [];
        }

        console.log(`💬 Procesando mensaje de ${ctx.from}: "${ctx.body}"`);
        
        let aiResponse: AIResponse = await getAIResponse(history, ctx.body);
        console.log(`🧠 Decisión inicial de la IA:`, aiResponse);
        
        let finalResponse = 'Lo siento, ocurrió un error inesperado y no pude procesar tu solicitud.';

        while (
            aiResponse.type === 'tool' &&
            aiResponse.data.tool === 'run_query_json' &&
            attempts < MAX_RETRY_ATTEMPTS
        ) {
            attempts++;
            console.log(`🤖 La IA decidió usar la herramienta 'run_query_json' (Intento #${attempts})`);

            const toolResult = await executeSql(aiResponse.data.payload, state as SessionState);
            console.log(`🔍 Resultado recibido de la herramienta MCP:`, toolResult);

            if (toolResult && toolResult.error) {
                console.log(`❌ La herramienta falló.`);
                const contextForCorrection = `La herramienta 'run_query_json' falló.
                - Tu consulta SQL fue: ${JSON.stringify(aiResponse.data.payload.sql)}
                - El error fue: "${toolResult.error}"
                - Corrige tu consulta y llama a la herramienta de nuevo. NO te disculpes.`;
                
                console.log(`🗣️ Enviando prompt de CORRECCIÓN a la IA...`);
                aiResponse = await getAIResponse(
                    [...history, { role: 'user', content: ctx.body }],
                    contextForCorrection
                );
                console.log(`🧠 Nueva decisión de la IA tras corrección:`, aiResponse);

            } else {
                console.log('✅ La herramienta se ejecutó con éxito.');
                
                let interpretationPrompt: string;

                if (Array.isArray(toolResult) && toolResult.length === 0) {
                    interpretationPrompt = `La consulta para buscar '${ctx.body}' se ejecutó con éxito pero no devolvió ningún resultado. Informa al usuario de manera amigable que no encontraste lo que buscaba. Usa la herramienta 'respond_to_user'.`;
                } else {
                    interpretationPrompt = `La consulta se ejecutó con éxito.
                    - El resultado de la base de datos es: ${JSON.stringify(toolResult)}.
                    - Resume esta información de forma clara y amigable para el usuario. Usa la herramienta 'respond_to_user'.`;
                }
                
                console.log(`🗣️ Enviando prompt de INTERPRETACIÓN a la IA...`);
                aiResponse = await getAIResponse(
                    [...history, { role: 'user', content: ctx.body }],
                    interpretationPrompt
                );
                console.log(`🧠 Decisión final de la IA tras interpretación:`, aiResponse);
                
                break; 
            }
        }

        if (aiResponse.type === 'tool' && aiResponse.data.tool === 'respond_to_user') {
            finalResponse = aiResponse.data.payload.response;
        } else if (aiResponse.type === 'text') {
            finalResponse = aiResponse.data;
        } else if (attempts >= MAX_RETRY_ATTEMPTS) {
            finalResponse = "Lo siento, he intentado corregir un error varias veces sin éxito.";
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