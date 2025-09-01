import OpenAI from 'openai';
import { env } from '../config/environment';
import { SYSTEM_PROMPT } from '../config/system_prompt';
import { ChatCompletionMessageParam } from 'openai/resources';

interface ToolData {
    tool: string;
    payload: any;
}

export type AIResponse = 
    | { type: 'text'; data: string }
    | { type: 'tool'; data: ToolData };

const openAIClient = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: env.openRouterApiKey,
    defaultHeaders: {
        'HTTP-Referer': 'https://github.com/joaquin-git/fp-agent',
        'X-Title': 'FP-Agent WhatsApp Bot',
    },
});

export const getAIResponse = async (
    history: ChatCompletionMessageParam[],
    userMessage: string
): Promise<AIResponse> => {

    const currentDate = new Date();
    const dynamicContext = `Contexto Actual: La fecha y hora de hoy es ${currentDate.toISOString()}.`;
    const fullSystemPrompt = `${dynamicContext}\n\n${SYSTEM_PROMPT}`;
    
    const messages: ChatCompletionMessageParam[] = [
        { role: 'system', content: fullSystemPrompt },
        ...history,
        { role: 'user', content: userMessage },
    ];

    try {
        console.log('--- INICIO: CONTEXTO COMPLETO ENVIADO A LA IA ---');
        console.log(JSON.stringify(messages, null, 2));
        console.log('--- FIN: CONTEXTO COMPLETO ENVIADO A LA IA ---');
        
        const completion = await openAIClient.chat.completions.create({
            model: 'google/gemini-flash-1.5',
            messages: messages,
            response_format: { type: 'json_object' }
        });

        const content = completion.choices[0].message.content;

        console.log('--- INICIO: RESPUESTA CRUDA RECIBIDA DE LA IA ---');
        console.log(content);
        console.log('--- FIN: RESPUESTA CRUDA RECIBIDA DE LA IA ---');

        if (!content) {
            console.error('Respuesta de la IA vacía.');
            return { type: 'text', data: 'Lo siento, no pude procesar tu solicitud.' };
        }

        try {
            const parsedJson = JSON.parse(content);
            
            if (parsedJson.tool_name && parsedJson.arguments) {
                return { 
                    type: 'tool', 
                    data: {
                        tool: parsedJson.tool_name,
                        payload: parsedJson.arguments
                    } 
                };
            }
            
            return { type: 'text', data: content };

        } catch (error) {
            return { type: 'text', data: content };
        }

    } catch (error) {
        console.error('❌ Error al comunicarse con la API de OpenRouter:', error);
        return {
            type: 'text',
            data: 'Hubo un problema de conexión con mi cerebro (la IA).'
        };
    }
};