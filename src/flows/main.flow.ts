import { addKeyword, EVENTS } from '@builderbot/bot';
import { env } from '../config/environment';
import { getAIResponse, AIResponse } from '../services/openrouter.service';
import { executeSql, SessionState } from '../services/mcp.service';
import { ChatCompletionMessageParam } from 'openai/resources';
import { SYSTEM_PROMPT } from '../config/system_prompt';

const CONVERSATION_EXPIRATION_MS = 30 * 60 * 1000;
const MAX_RETRY_ATTEMPTS = 5;

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

        console.log(`\n💬 [main.flow.ts] Procesando mensaje: "${ctx.body}"`);

        const currentDate = new Date();
        const fullSystemPrompt = `Contexto Actual: La fecha y hora de hoy es ${currentDate.toISOString()}.\n\n${SYSTEM_PROMPT}`;

        let initialMessages: ChatCompletionMessageParam[] = [
            { role: 'system', content: fullSystemPrompt },
            ...history,
            { role: 'user', content: ctx.body }
        ];
        
        let aiResponse: AIResponse = await getAIResponse(initialMessages);
        console.log(`🧠 [main.flow.ts] Decisión inicial de la IA:`, aiResponse);
        
        let finalResponse = 'Lo siento, ocurrió un error inesperado.';
        let attempts = 0;

        while (
            aiResponse.type === 'tool' &&
            aiResponse.data.tool === 'run_query_json' &&
            attempts < MAX_RETRY_ATTEMPTS
        ) {
            attempts++;
            console.log(`🤖 [main.flow.ts] La IA decidió usar la herramienta 'run_query_json' (Intento #${attempts})`);

            const toolResult = await executeSql(aiResponse.data.payload, state as SessionState);
            console.log(`🔍 [main.flow.ts] Resultado recibido de la herramienta en el flujo:`, toolResult);

            let nextMessages: ChatCompletionMessageParam[] = [
                ...initialMessages,
                { role: 'assistant', content: JSON.stringify(aiResponse.data) },
            ];

            if (toolResult && toolResult.error) {
                const contextForCorrection = `La herramienta falló. El error fue: "${toolResult.error}". Corrige tu consulta.`;
                nextMessages.push({ role: 'user' as const, content: contextForCorrection });
                console.log(`🗣️ [main.flow.ts] Enviando prompt de CORRECCIÓN a la IA...`);
            } else {
                let interpretationPrompt: string;
                if (Array.isArray(toolResult) && toolResult.length === 0) {
                    interpretationPrompt = `La consulta de búsqueda no devolvió ningún resultado. Informa al usuario que no encontraste lo que buscaba.`;
                } else {
                    interpretationPrompt = `La consulta tuvo éxito. El resultado es: ${JSON.stringify(toolResult)}. Resume esto para el usuario.`;
                }
                nextMessages.push({ role: 'user' as const, content: interpretationPrompt });
                console.log(`🗣️ [main.flow.ts] Enviando prompt de INTERPRETACIÓN a la IA...`);
            }
            
            aiResponse = await getAIResponse(nextMessages);
            console.log(`🧠 [main.flow.ts] Nueva decisión de la IA tras resultado de herramienta:`, aiResponse);

            if(aiResponse.type === 'tool' && aiResponse.data.tool === 'respond_to_user') {
                break;
            }
        }

        if (aiResponse.type === 'tool' && aiResponse.data.tool === 'respond_to_user') {
            finalResponse = aiResponse.data.payload.response;
        } else if (aiResponse.type === 'text') {
            finalResponse = aiResponse.data;
        }
        
        const isUselessResponse = !finalResponse || finalResponse.trim() === '' || finalResponse.trim().startsWith('```');
        if (isUselessResponse) {
            finalResponse = "Lo siento, tuve un problema al generar la respuesta.";
        }

        console.log(`➡️  [main.flow.ts] Enviando respuesta final: "${finalResponse}"`);

        const newHistory: ChatCompletionMessageParam[] = [
            ...history,
            { role: 'user', content: ctx.body },
            { role: 'assistant', content: finalResponse }
        ];
        await state.update({ history: newHistory, lastInteraction: now });
        
        await flowDynamic(finalResponse);
    });