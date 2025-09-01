import { addKeyword, EVENTS } from '@builderbot/bot';
import { env } from '../config/environment';
import { getAIResponse, AIResponse } from '../services/openrouter.service';
import { executeSql, SessionState } from '../services/mcp.service';
import { ChatCompletionMessageParam } from 'openai/resources';
import { SYSTEM_PROMPT } from '../config/system_prompt';

const CONVERSATION_EXPIRATION_MS = 30 * 60 * 1000;
const MAX_RETRY_ATTEMPTS = 2;

export const mainFlow = addKeyword(EVENTS.WELCOME)
    .addAction(async (ctx, { endFlow }) => {
        if (ctx.from !== env.myPhoneNumber) { return endFlow(); }
    })
    .addAction(async (ctx, { state, flowDynamic }) => {
        if (ctx.body.toLowerCase().trim() === 'reset') {
            await state.update({ history: [], mcpSessionUrl: null });
            await flowDynamic("Ok, he reseteado nuestra conversación.");
            return;
        }

        const lastInteraction = state.get<number>('lastInteraction') || 0;
        const now = Date.now();
        let history = state.get<ChatCompletionMessageParam[]>('history') || [];
        if (now - lastInteraction > CONVERSATION_EXPIRATION_MS) { history = []; }

        console.log(`💬 Procesando: "${ctx.body}"`);

        const currentDate = new Date();
        const fullSystemPrompt = `Contexto Actual: La fecha y hora de hoy es ${currentDate.toISOString()}.\n\n${SYSTEM_PROMPT}`;

        // Construimos el contexto inicial para la primera llamada a la IA
        let messages: ChatCompletionMessageParam[] = [
            { role: 'system', content: fullSystemPrompt },
            ...history,
            { role: 'user', content: ctx.body }
        ];
        
        let aiResponse: AIResponse = await getAIResponse(messages);
        let finalResponse = 'Lo siento, ocurrió un error inesperado.';
        let attempts = 0;

        while (
            aiResponse.type === 'tool' &&
            aiResponse.data.tool === 'run_query_json' &&
            attempts < MAX_RETRY_ATTEMPTS
        ) {
            attempts++;
            const toolResult = await executeSql(aiResponse.data.payload, state as SessionState);
            console.log(`🔍 Resultado de la herramienta:`, toolResult);

            // Construimos un nuevo contexto para la siguiente llamada a la IA
            messages = [
                { role: 'system', content: fullSystemPrompt },
                ...history,
                { role: 'user', content: ctx.body },
                // Añadimos la acción que la IA acaba de tomar
                { role: 'assistant', content: JSON.stringify(aiResponse.data) },
            ];

            if (toolResult && toolResult.error) {
                const contextForCorrection = `La herramienta falló. El error fue: "${toolResult.error}". Corrige tu consulta.`;
                messages.push({ role: 'user', content: contextForCorrection });
            } else {
                let interpretationPrompt: string;
                if (Array.isArray(toolResult) && toolResult.length === 0) {
                    interpretationPrompt = `La consulta no devolvió ningún resultado. Informa al usuario que no encontraste lo que buscaba.`;
                } else {
                    interpretationPrompt = `La consulta tuvo éxito. El resultado es: ${JSON.stringify(toolResult)}. Resume esto para el usuario.`;
                }
                // Añadimos la instrucción de interpretación como un nuevo "turno" del sistema/usuario
                messages.push({ role: 'user', content: interpretationPrompt });
            }
            
            console.log(`🗣️ Enviando nuevo contexto a la IA para el siguiente paso...`);
            aiResponse = await getAIResponse(messages);
            if(aiResponse.type === 'tool' && aiResponse.data.tool === 'respond_to_user') {
                break; // Si la IA decide responder, salimos del bucle
            }
        }

        if (aiResponse.type === 'tool' && aiResponse.data.tool === 'respond_to_user') {
            finalResponse = aiResponse.data.payload.response;
        } else if (aiResponse.type === 'text') {
            finalResponse = aiResponse.data;
        }
        
        const isUselessResponse = !finalResponse || finalResponse.trim() === '' || finalResponse.trim().startsWith('```');
        if (isUselessResponse) {
            finalResponse = "Lo siento, tuve un problema al generar la respuesta. ¿Podrías intentarlo de nuevo?";
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