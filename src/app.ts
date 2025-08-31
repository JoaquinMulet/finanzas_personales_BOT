import { createBot, createProvider, createFlow } from '@builderbot/bot'
import { BaileysProvider as Provider } from '@builderbot/provider-baileys'
import { PostgreSQLAdapter } from '@builderbot/database-postgres'
import { env } from './config/environment'
import { mainFlow } from './flows/main.flow'

const adapterDB = new PostgreSQLAdapter(env.db)
const adapterProvider = createProvider(Provider)
const adapterFlow = createFlow([mainFlow])

const main = async () => {
    const { httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    })

    httpServer(env.port)
    console.log(`🤖 Bot de WhatsApp listo y escuchando en el puerto ${env.port}`)
    console.log('🔒 Escuchando únicamente los mensajes de:', env.myPhoneNumber)
    console.log('➡️  Para empezar, escanea el código QR que aparecerá en los logs.')
}

main()